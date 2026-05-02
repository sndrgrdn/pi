import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createLocalBashOperations, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateTail, type BashToolDetails } from "@mariozechner/pi-coding-agent";
import { randomBytes } from "crypto";
import { writeFile } from "fs/promises";
import { tmpdir } from "os";
import { isAbsolute, join, resolve } from "path";
import { Type } from "typebox";

const schema = Type.Object({
	command: Type.String({ description: "Bash command to execute" }),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)" })),
	workdir: Type.Optional(Type.String({ description: "Working directory for the command. Defaults to the current session directory." })),
});

const resolveWorkdir = (cwd: string, workdir?: string) => workdir ? (isAbsolute(workdir) ? workdir : resolve(cwd, workdir)) : cwd;

export default function (pi: ExtensionAPI) {
	const ops = createLocalBashOperations();
	pi.registerTool({
		name: "bash",
		label: "bash",
		description: `Execute a deterministic, non-interactive shell command for terminal operations such as git, package managers, test runners, and build tools. Runs in the current working directory unless workdir is provided; prefer workdir over \"cd ... &&\". Quote paths that contain spaces. Do not use bash for routine file reading, writing, editing, or content search when dedicated tools are available. Set timeout for commands that may hang. Non-zero exit codes fail the tool and include output. Output is truncated to the last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB; full output is saved to a temp file when truncated.`,
		promptSnippet: "Run a deterministic shell command",
		parameters: schema,
		async execute(_id, { command, timeout, workdir }, signal, onUpdate, ctx) {
			let output = "";
			const result = await ops.exec(command, resolveWorkdir(ctx.cwd, workdir), {
				timeout,
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
