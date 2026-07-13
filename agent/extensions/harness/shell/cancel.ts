/**
 * `shell_command_cancel` — kill a backgrounded process.
 *
 * Kill = killProcessTree verbatim: SIGKILL to the process group, the same
 * primitive as pi's foreground abort — one kill story. Cancel-preempts-poll:
 * always accepted, never queued; an in-flight status wait resolves
 * immediately with output-so-far + `cancelled` (non-error), and the cancel
 * call itself is the completing read — consumes the remainder, reports
 * cancelled, deletes the record.
 */
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createTraceRenderer, emitTraceRunning, type TraceToolRegistrar, withTraceDetails } from "../ui/trace.ts";
import { appendStatus, formatShellOutput } from "./output.ts";
import { type BackgroundShellRegistry, killProcessTree } from "./registry.ts";

const schema = Type.Object({
	id: Type.String({ description: "Background process id returned by shell_command (e.g. shell-3)." }),
});

interface ShellCancelParams {
	id: string;
}

const description = [
	"Kill a background process started by shell_command. SIGKILLs the whole process tree immediately.",
	"Returns any output produced since the last read and forgets the id.",
	"An in-flight shell_command_status wait on the same id resolves immediately with output-so-far and a cancelled marker.",
].join(" ");

const traceRenderer = createTraceRenderer<ShellCancelParams>({
	invocation: (args) => ({ action: "cancel", target: args.id }),
});

export function createShellCancelTool(registry: BackgroundShellRegistry): ToolDefinition<any, any, any> {
	return {
		name: "shell_command_cancel",
		label: "shell_command_cancel",
		description,
		parameters: schema,
		renderShell: "self",
		async execute(_toolCallId, params: ShellCancelParams, _signal, onUpdate, _ctx) {
			emitTraceRunning(onUpdate);
			// Lazy sweep of exited-but-unpolled records.
			registry.sweep();

			const record = registry.get(params.id);
			if (!record) throw registry.unknownIdError(params.id);

			// Cancel-preempts-poll: wake any in-flight status wait so it resolves
			// immediately with output-so-far + cancelled (non-error).
			registry.requestCancel(record);
			// One kill story: same primitive as pi's foreground abort.
			if (!record.exited && record.pid) killProcessTree(record.pid);
			// SIGKILL is not negotiable; wait for the close event so the final
			// output flush lands before the completing read.
			await record.exitPromise;
			// Claim the read slot once any preempted status wait has taken its
			// slice: the cursor stays single-reader and lossless.
			for (;;) {
				await registry.waitForReadRelease(record);
				try {
					registry.beginRead(record);
					break;
				} catch {
					// Lost the wake-up race to another reader; wait again.
				}
			}
			try {
				// A concurrent cancel may have completed the read while we waited.
				if (!registry.get(record.id)) throw registry.unknownIdError(record.id);

				// Cancel is the completing read: consume the remainder, forget the id.
				const { text, details } = formatShellOutput(registry.readAndAdvance(record), record.output.path);
				registry.completeRead(record.id);
				return {
					content: [{ type: "text", text: appendStatus(text, `cancelled ${record.id}`) }],
					details: withTraceDetails(details, "cancelled"),
				};
			} finally {
				registry.endRead(record);
			}
		},
		renderCall: traceRenderer.renderCall,
		renderResult: traceRenderer.renderResult,
	} as ToolDefinition<any, any, any>;
}

export function registerShellCancel(
	pi: ExtensionAPI,
	registry: BackgroundShellRegistry,
	register: TraceToolRegistrar["register"] = (tool) => pi.registerTool(tool),
): void {
	register(createShellCancelTool(registry));
}
