/**
 * `shell_command_status` — pure observation of backgrounded processes.
 *
 * Takes one id or an array; waits for every process to exit or the timeout,
 * streaming new output as progress. Reads are lossless since-last-read
 * slices backed by the accumulator temp-file
 * byte offset (cursor shared with the backgrounding snapshot and the final
 * cancel/completion read), each bounded by pi truncation. The read that
 * observes exit delivers remaining output + exit status exactly once
 * (nonzero → tool error unless the command set allow_nonzero) and deletes
 * the record.
 */
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createTraceRenderer, emitTraceRunning, type TraceToolRegistrar, withTraceDetails } from "../ui/trace.ts";
import { appendStatus, type FormattedOutput, formatShellOutput, UPDATE_THROTTLE_MS } from "./output.ts";
import {
	type BackgroundShellRegistry,
	clampTimeoutMs,
	DEFAULT_TIMEOUT_MS,
	MAX_TIMEOUT_MS,
	type ShellProcessRecord,
} from "./registry.ts";

const schema = Type.Object({
	id: Type.Union([Type.String(), Type.Array(Type.String(), { minItems: 1 })], {
		description:
			"Background process id returned by shell_command (e.g. shell-3), or an array of ids to wait on together.",
	}),
	timeout_ms: Type.Optional(
		Type.Number({
			description: `How long to wait for completion in milliseconds (default ${DEFAULT_TIMEOUT_MS}, max ${MAX_TIMEOUT_MS}). 0 returns an instant snapshot.`,
		}),
	),
});

interface ShellStatusParams {
	id: string | string[];
	timeout_ms?: number;
}

const description = [
	"Poll background processes started by shell_command and return output produced since the last read (lossless cursor).",
	`Accepts one id or an array of ids and waits up to timeout_ms (default ${DEFAULT_TIMEOUT_MS / 1000}s, max ${MAX_TIMEOUT_MS / 1000}s) for every one to exit; timeout_ms 0 returns an instant snapshot.`,
	"Observes without stopping the process; shell_command_cancel stops it.",
	"The read that observes an exit reports it once and forgets that id; a nonzero exit fails the tool unless the command set allow_nonzero.",
	"Output is bounded like shell_command output; the full temp-file path is included when truncated.",
].join(" ");

const traceRenderer = createTraceRenderer<ShellStatusParams>({
	invocation: (args) => ({ action: "poll", target: Array.isArray(args.id) ? args.id.join(" ") : args.id }),
});

function exitLabel(record: ShellProcessRecord): string {
	return `exited ${record.exitCode ?? "(signal)"}`;
}

export function createShellStatusTool(registry: BackgroundShellRegistry): ToolDefinition<any, any, any> {
	return {
		name: "shell_command_status",
		label: "shell_command_status",
		description,
		parameters: schema,
		renderShell: "self",
		async execute(_toolCallId, params: ShellStatusParams, signal, onUpdate, _ctx) {
			emitTraceRunning(onUpdate);
			// Lazy sweep of exited-but-unpolled records.
			registry.sweep();

			const multi = Array.isArray(params.id);
			const ids = multi ? [...new Set(params.id as string[])] : [params.id as string];
			if (ids.length === 0) throw new Error("requires at least one id");

			// Resolve every id before any cursor moves; one unknown id fails the call.
			const records: ShellProcessRecord[] = ids.map((id) => {
				const record = registry.get(id);
				if (!record) throw registry.unknownIdError(id);
				return record;
			});

			// Single-flight covers the whole set; release on partial acquisition.
			const began: ShellProcessRecord[] = [];
			try {
				for (const record of records) {
					registry.beginRead(record);
					began.push(record);
				}
			} catch (error) {
				for (const record of began) registry.endRead(record);
				throw error;
			}

			let updateTimer: ReturnType<typeof setInterval> | undefined;
			try {
				const timeoutMs = clampTimeoutMs(params.timeout_ms);

				if (timeoutMs > 0 && records.some((record) => !record.exited)) {
					// Stream new output as progress without advancing cursors;
					// the final readAndAdvance below stays lossless.
					const lastEmitted = new Map(records.map((record) => [record.id, record.cursor]));
					if (onUpdate) {
						updateTimer = setInterval(() => {
							const parts: string[] = [];
							let details: FormattedOutput["details"];
							for (const record of records) {
								if (record.output.bytesWritten <= (lastEmitted.get(record.id) ?? 0)) continue;
								lastEmitted.set(record.id, record.output.bytesWritten);
								const formatted = formatShellOutput(
									record.output.readSlice(record.cursor, record.output.bytesWritten),
									record.output.path,
								);
								parts.push(multi ? `[${record.id}]\n${formatted.text}` : formatted.text);
								details = formatted.details;
							}
							if (!parts.length) return;
							onUpdate({
								content: [{ type: "text", text: parts.join("\n\n") }],
								details: withTraceDetails(multi ? undefined : details, "running"),
							});
						}, UPDATE_THROTTLE_MS);
					}

					let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
					let onAbort: (() => void) | undefined;
					try {
						await Promise.race([
							// Cancel-preempts-poll: a cancel wakes the wait for its record.
							Promise.all(records.map((record) => Promise.race([record.exitPromise, record.cancelPromise]))),
							new Promise<void>((resolvePromise) => {
								timeoutHandle = setTimeout(resolvePromise, timeoutMs);
								onAbort = () => resolvePromise();
								if (signal) {
									if (signal.aborted) resolvePromise();
									else signal.addEventListener("abort", onAbort, { once: true });
								}
							}),
						]);
					} finally {
						if (timeoutHandle) clearTimeout(timeoutHandle);
						if (onAbort) signal?.removeEventListener("abort", onAbort);
					}
				}

				if (signal?.aborted) {
					// Pure observation: abort ends the wait without consuming output.
					throw new Error("Status check aborted");
				}

				const sections: string[] = [];
				let singleDetails: FormattedOutput["details"];
				let failed = false;
				let runningCount = 0;
				let cancelledCount = 0;
				let exitedCount = 0;
				for (const record of records) {
					const { text, details } = formatShellOutput(registry.readAndAdvance(record), record.output.path);
					singleDetails = details;
					let label: string;
					if (record.cancelled) {
						// Preempted by cancel: non-error with output-so-far. The
						// cancel call is the completing read, not this one.
						label = `${record.id} · cancelled`;
						cancelledCount += 1;
					} else if (!record.exited) {
						label = `${record.id} · still running`;
						runningCount += 1;
					} else {
						// Completing read: report exit exactly once, forget the record.
						registry.completeRead(record.id);
						label = multi ? `${record.id} · ${exitLabel(record)}` : exitLabel(record);
						exitedCount += 1;
						if (record.exitCode !== 0 && record.exitCode !== null && !record.allowNonzero) failed = true;
					}
					sections.push(appendStatus(text, label));
				}

				const combined = sections.join("\n\n");
				if (failed) throw new Error(combined);

				const state = !multi && cancelledCount ? "cancelled" : "success";
				const qualifiers = multi
					? [
							...(exitedCount ? [`${exitedCount} exited`] : []),
							...(runningCount ? [`${runningCount} running`] : []),
							...(cancelledCount ? [`${cancelledCount} cancelled`] : []),
						]
					: runningCount
						? ["still running"]
						: undefined;
				return {
					content: [{ type: "text", text: combined }],
					details: withTraceDetails(multi ? undefined : singleDetails, state, qualifiers),
				};
			} finally {
				if (updateTimer) clearInterval(updateTimer);
				for (const record of began) registry.endRead(record);
			}
		},
		renderCall: traceRenderer.renderCall,
		renderResult: traceRenderer.renderResult,
	} as ToolDefinition<any, any, any>;
}

export function registerShellStatus(
	pi: ExtensionAPI,
	registry: BackgroundShellRegistry,
	register: TraceToolRegistrar["register"] = (tool) => pi.registerTool(tool),
): void {
	register(createShellStatusTool(registry));
}
