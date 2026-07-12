/**
 * `shell_command_cancel` — kill a backgrounded process (spec §4.3).
 *
 * Kill = killProcessTree verbatim: SIGKILL to the process group, the same
 * primitive as pi's foreground abort — one kill story. Cancel-preempts-poll:
 * always accepted, never queued; an in-flight status wait resolves
 * immediately with output-so-far + `cancelled` (non-error), and the cancel
 * call itself is the completing read — consumes the remainder, reports
 * cancelled, deletes the record.
 */
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
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

export function createShellCancelTool(registry: BackgroundShellRegistry): ToolDefinition<any, any, any> {
	const base = createBashToolDefinition(process.cwd());
	return {
		name: "shell_command_cancel",
		label: "shell_command_cancel",
		description,
		parameters: schema,
		async execute(_toolCallId, params: ShellCancelParams, _signal, _onUpdate, _ctx) {
			// Lazy sweep of exited-but-unpolled records (spec §4.2 lifetime).
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
			// Sequence after the preempted wait's slice read: cursor stays lossless.
			await registry.waitForReadRelease(record);

			// Cancel is the completing read: consume the remainder, forget the id.
			const { text, details } = formatShellOutput(registry.readAndAdvance(record), record.output.path);
			registry.completeRead(record.id);
			return { content: [{ type: "text", text: appendStatus(text, `cancelled ${record.id}`) }], details };
		},
		// Compact row `cancelled shell-N · $ <command>` (spec §4.3 UI); final
		// output collapsed via pi's bash result renderer.
		renderCall(args: ShellCancelParams | undefined, theme, context) {
			const command = args ? registry.commandFor(args.id) : undefined;
			const title = args ? `cancelled ${args.id}${command ? ` · $ ${command}` : ""}` : "...";
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(theme.fg("toolTitle", theme.bold(title)));
			return text;
		},
		renderResult(result, options, theme, context) {
			return base.renderResult?.(result, options, theme, context as any);
		},
	} as ToolDefinition<any, any, any>;
}

export function registerShellCancel(pi: ExtensionAPI, registry: BackgroundShellRegistry): void {
	pi.registerTool(createShellCancelTool(registry));
}
