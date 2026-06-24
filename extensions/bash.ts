import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createBashToolDefinition, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";
import { tmpdir } from "os";
import { isAbsolute, resolve } from "path";
import { Type } from "typebox";

const DEFAULT_TIMEOUT_SECONDS = 120;
const NON_INTERACTIVE_GIT_ENV = "export GIT_EDITOR=true GIT_SEQUENCE_EDITOR=true GIT_MERGE_AUTOEDIT=no GIT_TERMINAL_PROMPT=0";

const CD_PATTERN = /^\s*cd\b/;

const schema = Type.Object({
	command: Type.String({ description: "The command to execute. Do not use cd — use the workdir parameter instead." }),
	timeout: Type.Optional(Type.Number({ description: `Timeout in seconds (default: ${DEFAULT_TIMEOUT_SECONDS}). Set for long or potentially hanging commands.` })),
	workdir: Type.Optional(Type.String({ description: "The working directory to run the command in. Defaults to the current directory. Use this instead of 'cd' commands." })),
});

const description = [
	"Execute a non-interactive shell command.",
	`Use ${tmpdir()} for temporary work outside the workspace.`,
	"Avoid cat/head/tail, sed/awk, echo/printf/heredoc writes — use dedicated file tools (read, edit, write).",
	"Always quote file paths that contain spaces with double quotes.",
	`Non-zero exit codes fail the tool. Output truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB.`,
	"If output is truncated, the full output is saved to a file — use read with offset/limit or grep to search it. Do not use head/tail to limit output.",
].join(" ");

const resolveWorkdir = (cwd: string, workdir?: string) => workdir ? (isAbsolute(workdir) ? workdir : resolve(cwd, workdir)) : cwd;
const forceNonInteractiveGit = (command: string) => `${NON_INTERACTIVE_GIT_ENV}\n${command}`;

export default function (pi: ExtensionAPI) {
	const base = createBashToolDefinition(process.cwd());
	pi.registerTool({
		...base,
		description,
		parameters: schema,
		async execute(toolCallId, params: { command: string; timeout?: number; workdir?: string }, signal, onUpdate, ctx) {
			const { command, timeout = DEFAULT_TIMEOUT_SECONDS, workdir } = params;

			if (CD_PATTERN.test(command)) {
				return {
					content: [{ type: "text" as const, text: "[note: use the workdir parameter instead of cd]" }],
				};
			}

			const tool = createBashToolDefinition(resolveWorkdir(ctx.cwd, workdir));
			return tool.execute(toolCallId, { command: forceNonInteractiveGit(command), timeout }, signal, onUpdate, ctx);
		},
	} as ToolDefinition<any, any, any>);
}
