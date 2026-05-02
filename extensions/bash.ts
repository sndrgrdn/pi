import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createLocalBashOperations, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateTail, type BashToolDetails } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { randomBytes } from "crypto";
import { writeFile } from "fs/promises";
import { tmpdir } from "os";
import { isAbsolute, join, resolve } from "path";
import { Type } from "typebox";

const DEFAULT_TIMEOUT_SECONDS = 120;

const schema = Type.Object({
	command: Type.String({ description: "Bash command to execute" }),
	timeout: Type.Optional(Type.Number({ description: `Timeout in seconds. Defaults to ${DEFAULT_TIMEOUT_SECONDS}s. Set for commands that may hang or run long.` })),
	workdir: Type.Optional(Type.String({ description: `Working directory. Defaults to session cwd. Prefer over "cd ... &&".` })),
	description: Type.Optional(Type.String({ description: "Clear, concise description of what this command does in 5-10 words" })),
});

const resolveWorkdir = (cwd: string, workdir?: string) => workdir ? (isAbsolute(workdir) ? workdir : resolve(cwd, workdir)) : cwd;

function renderBashCall(args: { command?: string; timeout?: number; description?: string }, theme: any, context: any) {
	const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
	const title = args.description?.trim() || args.command || "...";
	const timeout = args.timeout ? theme.fg("muted", ` (timeout ${args.timeout}s)`) : "";
	let output = theme.fg("toolTitle", theme.bold(`$ ${title}`)) + timeout;
	if (args.description?.trim() && args.command) output += `\n${theme.fg("muted", args.command)}`;
	text.setText(output);
	return text;
}

export default function (pi: ExtensionAPI) {
	const ops = createLocalBashOperations();
	pi.registerTool({
		name: "bash",
		label: "bash",
		description: [
			"Execute a deterministic, non-interactive shell command.",
			`Use ${tmpdir()} for temporary work outside the workspace.`,
			"Do not use bash for file reading, writing, editing, or searching — use dedicated tools (read, edit, apply_patch, write, rg/fd/sg).",
			"Avoid cat/head/tail, sed/awk, echo/printf/heredoc writes, find, and grep unless explicitly requested.",
			`Non-zero exit codes fail the tool. Output truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB.`,
		].join(" "),
		promptSnippet: "Run a deterministic shell command",
		parameters: schema,
		renderCall: renderBashCall,
		async execute(_id, { command, timeout, workdir }, signal, onUpdate, ctx) {
			let output = "";
			const result = await ops.exec(command, resolveWorkdir(ctx.cwd, workdir), {
				timeout: timeout ?? DEFAULT_TIMEOUT_SECONDS,
				signal,
				onData: (data) => {
					output += data.toString("utf-8");
					onUpdate?.({ content: [{ type: "text", text: output }], details: undefined });
				},
			});
			const truncation = truncateTail(output, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
			const details: BashToolDetails = { truncation };
			if (truncation.truncated) {
				const fullOutputPath = join(tmpdir(), `pi-bash-${randomBytes(8).toString("hex")}.log`);
				await writeFile(fullOutputPath, output, "utf-8");
				details.fullOutputPath = fullOutputPath;
			}
			let text = truncation.content || "(no output)";
			if (truncation.truncated && details.fullOutputPath) text += `\n\n[Full output: ${details.fullOutputPath}]`;
			if (result.exitCode !== 0 && result.exitCode !== null) throw new Error(`${text}\n\nCommand exited with code ${result.exitCode}`);
			return { content: [{ type: "text", text }], details };
		},
	});
}
