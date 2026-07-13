/**
 * `shell_command_status` — pure observation of a backgrounded process (spec §4.2).
 *
 * Waits for completion or timeout, streaming new output as progress. Reads
 * are lossless since-last-read slices backed by the accumulator temp-file
 * byte offset (cursor shared with the backgrounding snapshot and the final
 * cancel/completion read), each bounded by pi truncation. The read that
 * observes exit delivers remaining output + exit status exactly once
 * (nonzero → tool error) and deletes the record.
 */
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { appendStatus, bashToolBase, formatShellOutput, renderToolTitle, UPDATE_THROTTLE_MS } from "./output.ts";
import {
	type BackgroundShellRegistry,
	clampTimeoutMs,
	DEFAULT_TIMEOUT_MS,
	MAX_TIMEOUT_MS,
	type ShellProcessRecord,
} from "./registry.ts";

const schema = Type.Object({
	id: Type.String({ description: "Background process id returned by shell_command (e.g. shell-3)." }),
	timeout_ms: Type.Optional(
		Type.Number({
			description: `How long to wait for completion in milliseconds (default ${DEFAULT_TIMEOUT_MS}, max ${MAX_TIMEOUT_MS}). 0 returns an instant snapshot.`,
		}),
	),
});

interface ShellStatusParams {
	id: string;
	timeout_ms?: number;
}

const description = [
	"Poll a background process started by shell_command. Returns output produced since the last read (lossless cursor).",
	`Waits up to timeout_ms (default ${DEFAULT_TIMEOUT_MS / 1000}s, max ${MAX_TIMEOUT_MS / 1000}s) for the process to exit; timeout_ms 0 returns an instant snapshot.`,
	"Pure observation — never kills the process; use shell_command_cancel for that.",
	"The read that observes exit reports the exit status exactly once and forgets the id; a nonzero exit is a tool error.",
	"Output is truncated to the last 2000 lines or 50KB; the full output temp-file path is included when truncated.",
].join(" ");

function exitLabel(record: ShellProcessRecord): string {
	return `exited ${record.exitCode ?? "(signal)"}`;
}

export function createShellStatusTool(registry: BackgroundShellRegistry): ToolDefinition<any, any, any> {
	return {
		name: "shell_command_status",
		label: "shell_command_status",
		description,
		parameters: schema,
		async execute(_toolCallId, params: ShellStatusParams, signal, onUpdate, _ctx) {
			// Lazy sweep of exited-but-unpolled records (spec §4.2 lifetime).
			registry.sweep();

			const record = registry.get(params.id);
			if (!record) throw registry.unknownIdError(params.id);
			registry.beginRead(record);

			let updateTimer: ReturnType<typeof setInterval> | undefined;
			try {
				const timeoutMs = clampTimeoutMs(params.timeout_ms);

				if (!record.exited && timeoutMs > 0) {
					// Stream new output as progress without advancing the cursor;
					// the final readAndAdvance below stays lossless.
					let lastEmitted = record.cursor;
					if (onUpdate) {
						updateTimer = setInterval(() => {
							if (record.output.bytesWritten <= lastEmitted) return;
							lastEmitted = record.output.bytesWritten;
							const { text, details } = formatShellOutput(
								record.output.readSlice(record.cursor, lastEmitted),
								record.output.path,
							);
							onUpdate({ content: [{ type: "text", text }], details });
						}, UPDATE_THROTTLE_MS);
					}

					let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
					let onAbort: (() => void) | undefined;
					try {
						await Promise.race([
							record.exitPromise,
							// Cancel-preempts-poll (spec §4.3): a cancel wakes this wait.
							record.cancelPromise,
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

				const { text, details } = formatShellOutput(registry.readAndAdvance(record), record.output.path);

				if (record.cancelled) {
					// Preempted by cancel: resolve non-error with output-so-far.
					// The cancel call is the completing read, not this one.
					return { content: [{ type: "text", text: appendStatus(text, `${record.id} · cancelled`) }], details };
				}

				if (!record.exited) {
					return {
						content: [{ type: "text", text: appendStatus(text, `${record.id} · still running`) }],
						details,
					};
				}

				// Completing read: report exit exactly once, forget the record.
				registry.completeRead(record.id);
				if (record.exitCode !== 0 && record.exitCode !== null) {
					throw new Error(appendStatus(text, exitLabel(record)));
				}
				return { content: [{ type: "text", text: appendStatus(text, exitLabel(record)) }], details };
			} finally {
				if (updateTimer) clearInterval(updateTimer);
				registry.endRead(record);
			}
		},
		// Pi bash widget chrome, id-prefixed: `shell-N · $ <original command>`
		// (spec §4.2 UI). renderResult delegates to pi's bash renderer, sharing
		// the same elapsed-time state.
		renderCall(args: ShellStatusParams | undefined, theme, context) {
			const state = context.state as { startedAt?: number; endedAt?: number };
			if (context.executionStarted && state.startedAt === undefined) {
				state.startedAt = Date.now();
				state.endedAt = undefined;
			}
			const command = args ? registry.commandFor(args.id) : undefined;
			const title = args ? (command ? `${args.id} · $ ${command}` : args.id) : "...";
			return renderToolTitle(title, theme, context);
		},
		renderResult(result, options, theme, context) {
			return bashToolBase.renderResult?.(result, options, theme, context as any);
		},
	} as ToolDefinition<any, any, any>;
}

export function registerShellStatus(pi: ExtensionAPI, registry: BackgroundShellRegistry): void {
	pi.registerTool(createShellStatusTool(registry));
}
