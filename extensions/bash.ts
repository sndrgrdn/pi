import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createBashToolDefinition, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";
import { tmpdir } from "os";
import { isAbsolute, resolve } from "path";
import { Type } from "typebox";

const DEFAULT_TIMEOUT_SECONDS = 120;

const schema = Type.Object({
	command: Type.String({ description: "Bash command to execute" }),
	timeout: Type.Optional(Type.Number({ description: `Timeout in seconds. Defaults to ${DEFAULT_TIMEOUT_SECONDS}s. Set for commands that may hang or run long.` })),
	workdir: Type.Optional(Type.String({ description: `Working directory. Defaults to session cwd. Prefer over "cd ... &&".` })),
});

const description = [
	"Execute a non-interactive shell command.",
	`Use ${tmpdir()} for temporary work outside the workspace.`,
	"rg, fd, git, test runners, and build tools run through bash.",
	"Avoid cat/head/tail, sed/awk, echo/printf/heredoc writes — use dedicated file tools (read, edit, apply_patch, write). Prefer rg over grep, fd over find.",
	`Non-zero exit codes fail the tool. Output truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB.`,
].join(" ");

const resolveWorkdir = (cwd: string, workdir?: string) => workdir ? (isAbsolute(workdir) ? workdir : resolve(cwd, workdir)) : cwd;

export default function (pi: ExtensionAPI) {
	const base = createBashToolDefinition(process.cwd());
	pi.registerTool({
		...base,
		description,
		parameters: schema,
		async execute(toolCallId, params: { command: string; timeout?: number; workdir?: string }, signal, onUpdate, ctx) {
			const { command, timeout = DEFAULT_TIMEOUT_SECONDS, workdir } = params;
			const tool = createBashToolDefinition(resolveWorkdir(ctx.cwd, workdir));
			return tool.execute(toolCallId, { command, timeout }, signal, onUpdate, ctx);
		},
	} as ToolDefinition<any, any, any>);
}
