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
	classifyCompletion,
	DEFAULT_TIMEOUT_MS,
	MAX_TIMEOUT_MS,
	type ShellCompletion,
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

/** Wire shape → non-empty deduplicated id list, keeping array-ness for presentation. */
function parseIdParam(id: string | string[]): { ids: [string, ...string[]]; multi: boolean } {
	const multi = Array.isArray(id);
	const [first, ...rest] = new Set(multi ? id : [id]);
	if (first === undefined) throw new Error("id array must contain at least one id");
	return { ids: [first, ...rest], multi };
}

/** Resolve every id and acquire single-flight reads, all or nothing. */
function acquireRecords(registry: BackgroundShellRegistry, ids: readonly string[]): ShellProcessRecord[] {
	const records = ids.map((id) => {
		const record = registry.get(id);
		if (!record) throw registry.unknownIdError(id);
		return record;
	});
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
	return records;
}

/**
 * Wait until every record exits or is cancelled, the timeout fires, or the
 * signal aborts; ticks onProgress on the TUI throttle while waiting.
 */
async function awaitCompletion(
	records: readonly ShellProcessRecord[],
	timeoutMs: number,
	signal: AbortSignal | undefined,
	onProgress: (() => void) | undefined,
): Promise<void> {
	if (timeoutMs <= 0 || records.every((record) => record.exited)) return;
	const progressTimer = onProgress ? setInterval(onProgress, UPDATE_THROTTLE_MS) : undefined;
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
		if (progressTimer) clearInterval(progressTimer);
		if (timeoutHandle) clearTimeout(timeoutHandle);
		if (onAbort) signal?.removeEventListener("abort", onAbort);
	}
}

type ReadingOutcome = { kind: "cancelled" } | { kind: "running" } | { kind: "exited"; completion: ShellCompletion };

interface RecordReading {
	id: string;
	formatted: FormattedOutput;
	outcome: ReadingOutcome;
}

/**
 * Consume each record's since-last-read slice and classify where it stands.
 * Exited records are read-once: classifying one here deletes it.
 */
function consumeReadings(registry: BackgroundShellRegistry, records: readonly ShellProcessRecord[]): RecordReading[] {
	return records.map((record) => {
		const formatted = formatShellOutput(registry.readAndAdvance(record), record.output.path);
		let outcome: ReadingOutcome;
		if (record.cancelled) {
			// Preempted by cancel: the cancel call is the completing read, not this one.
			outcome = { kind: "cancelled" };
		} else if (!record.exited) {
			outcome = { kind: "running" };
		} else {
			// Completing read: report exit exactly once, forget the record.
			registry.completeRead(record.id);
			outcome = { kind: "exited", completion: classifyCompletion(record.exitCode, record.allowNonzero === true) };
		}
		return { id: record.id, formatted, outcome };
	});
}

function readingLabel(reading: RecordReading, multi: boolean): string {
	switch (reading.outcome.kind) {
		case "cancelled":
			return `${reading.id} · cancelled`;
		case "running":
			return `${reading.id} · still running`;
		case "exited":
			return multi ? `${reading.id} · ${reading.outcome.completion.label}` : reading.outcome.completion.label;
	}
}

function resultQualifiers(readings: readonly RecordReading[], multi: boolean): string[] | undefined {
	const only = readings.find(() => true);
	if (!multi) {
		if (only?.outcome.kind === "running") return ["still running"];
		if (only?.outcome.kind === "exited") return only.outcome.completion.qualifiers;
		return undefined;
	}
	const count = (kind: ReadingOutcome["kind"]) => readings.filter((reading) => reading.outcome.kind === kind).length;
	const exited = count("exited");
	const running = count("running");
	const cancelled = count("cancelled");
	return [
		...(exited ? [`${exited} exited`] : []),
		...(running ? [`${running} running`] : []),
		...(cancelled ? [`${cancelled} cancelled`] : []),
	];
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

			const { ids, multi } = parseIdParam(params.id);
			const records = acquireRecords(registry, ids);
			try {
				// Stream new output as progress without advancing cursors;
				// the final consumeReadings below stays lossless.
				const lastEmitted = new Map(records.map((record) => [record.id, record.cursor]));
				const emitProgress = () => {
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
					onUpdate?.({
						content: [{ type: "text", text: parts.join("\n\n") }],
						details: withTraceDetails(multi ? undefined : details, "running"),
					});
				};

				await awaitCompletion(records, clampTimeoutMs(params.timeout_ms), signal, onUpdate && emitProgress);

				if (signal?.aborted) {
					// Pure observation: abort ends the wait without consuming output.
					throw new Error("Status check aborted");
				}

				const readings = consumeReadings(registry, records);
				const combined = readings
					.map((reading) => appendStatus(reading.formatted.text, readingLabel(reading, multi)))
					.join("\n\n");
				if (readings.some((reading) => reading.outcome.kind === "exited" && reading.outcome.completion.failed)) {
					throw new Error(combined);
				}

				const cancelled = !multi && readings.some((reading) => reading.outcome.kind === "cancelled");
				return {
					content: [{ type: "text", text: combined }],
					details: withTraceDetails(
						multi ? undefined : readings.find(() => true)?.formatted.details,
						cancelled ? "cancelled" : "success",
						resultQualifiers(readings, multi),
					),
				};
			} finally {
				for (const record of records) registry.endRead(record);
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
