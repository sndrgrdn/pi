/**
 * `shell_command` — wait-not-kill shell execution (spec §4.1).
 *
 * Runs foreground; if still running at the timeout (clamp 0–60s, default 10s)
 * it returns bounded output-so-far plus an opaque `shell-N` id and keeps
 * running in background. Spawn machinery and output bounds mirror pi's builtin
 * bash tool; the TUI delegates to pi's bash renderers verbatim.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { getAgentDir, getShellConfig } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { appendStatus, bashToolBase, formatShellOutput, UPDATE_THROTTLE_MS } from "./output.ts";
import {
	BackgroundShellRegistry,
	clampTimeoutMs,
	DEFAULT_TIMEOUT_MS,
	killProcessTree,
	MAX_TIMEOUT_MS,
	ShellOutputFile,
} from "./registry.ts";

const schema = Type.Object({
	command: Type.String({ description: "The shell command to execute. Do not use cd — use the workdir parameter instead." }),
	workdir: Type.Optional(
		Type.String({ description: "Working directory to run the command in. Defaults to the session cwd." }),
	),
	timeout_ms: Type.Optional(
		Type.Number({
			description: `Foreground wait in milliseconds (default ${DEFAULT_TIMEOUT_MS}, max ${MAX_TIMEOUT_MS}). The command is NOT killed at the timeout — it keeps running in background and an id is returned for polling.`,
		}),
	),
});

interface ShellCommandParams {
	command: string;
	workdir?: string;
	timeout_ms?: number;
}

const description = [
	"Execute a non-interactive shell command. Returns stdout and stderr.",
	`Waits up to timeout_ms (default ${DEFAULT_TIMEOUT_MS / 1000}s, max ${MAX_TIMEOUT_MS / 1000}s) for completion.`,
	"If the command is still running at the timeout it is NOT killed: the tool returns output-so-far plus a background id (e.g. shell-3).",
	"Poll it with shell_command_status or kill it with shell_command_cancel.",
	"Non-zero exit codes on a completed run fail the tool.",
	"Output is truncated to the last 2000 lines or 50KB; full output is saved to a temp file whose path is included when truncated.",
].join(" ");

/** Mirror pi's internal getShellEnv: prepend the agent bin dir to PATH. */
function shellEnv(): NodeJS.ProcessEnv {
	const binDir = join(getAgentDir(), "bin");
	const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";
	const currentPath = process.env[pathKey] ?? "";
	const entries = currentPath.split(delimiter).filter(Boolean);
	const updatedPath = entries.includes(binDir) ? currentPath : [binDir, currentPath].filter(Boolean).join(delimiter);
	return { ...process.env, [pathKey]: updatedPath };
}

function resolveWorkdir(cwd: string, workdir?: string): string {
	return workdir ? (isAbsolute(workdir) ? workdir : resolve(cwd, workdir)) : cwd;
}

export function createShellCommandTool(registry: BackgroundShellRegistry): ToolDefinition<any, any, any> {
	return {
		name: "shell_command",
		label: "shell_command",
		description,
		parameters: schema,
		async execute(_toolCallId, params: ShellCommandParams, signal, onUpdate, ctx) {
			const workdir = resolveWorkdir(ctx.cwd, params.workdir);
			if (!existsSync(workdir)) {
				throw new Error(`Working directory does not exist: ${workdir}`);
			}
			const timeoutMs = clampTimeoutMs(params.timeout_ms);
			if (signal?.aborted) throw new Error("Command aborted");

			const { shell, args } = getShellConfig();
			const output = new ShellOutputFile();
			const child = spawn(shell, [...args, params.command], {
				cwd: workdir,
				detached: process.platform !== "win32",
				env: shellEnv(),
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true,
			});

			let spawnError: Error | undefined;
			let exited = false;
			let exitCode: number | null = null;
			const exitPromise = new Promise<number | null>((resolvePromise) => {
				child.once("error", (err) => {
					spawnError = err;
					exited = true;
					resolvePromise(null);
				});
				child.once("close", (code) => {
					exited = true;
					exitCode = code;
					resolvePromise(code);
				});
			});

			// Throttled streaming updates for the TUI (pi bash parity: 100ms).
			let updateTimer: ReturnType<typeof setTimeout> | undefined;
			let updateDirty = false;
			let lastUpdateAt = 0;
			const emitUpdate = () => {
				if (!onUpdate || !updateDirty) return;
				updateDirty = false;
				lastUpdateAt = Date.now();
				const { text, details } = formatShellOutput(output.readSlice(0), output.path);
				onUpdate({ content: [{ type: "text", text }], details });
			};
			const scheduleUpdate = () => {
				if (!onUpdate) return;
				updateDirty = true;
				const delay = UPDATE_THROTTLE_MS - (Date.now() - lastUpdateAt);
				if (delay <= 0) {
					if (updateTimer) clearTimeout(updateTimer);
					updateTimer = undefined;
					emitUpdate();
					return;
				}
				updateTimer ??= setTimeout(() => {
					updateTimer = undefined;
					emitUpdate();
				}, delay);
			};
			const handleData = (data: Buffer) => {
				output.append(data);
				scheduleUpdate();
			};
			child.stdout?.on("data", handleData);
			child.stderr?.on("data", handleData);

			// Foreground abort kills the process tree; backgrounded processes
			// survive turn aborts (spec §4.1 kill paths).
			let backgrounded = false;
			const onAbort = () => {
				if (!backgrounded && child.pid) killProcessTree(child.pid);
			};
			if (signal) {
				if (signal.aborted) onAbort();
				else signal.addEventListener("abort", onAbort, { once: true });
			}

			let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
			try {
				await Promise.race([
					exitPromise,
					new Promise<void>((resolvePromise) => {
						timeoutHandle = setTimeout(resolvePromise, timeoutMs);
					}),
				]);
			} finally {
				if (timeoutHandle) clearTimeout(timeoutHandle);
				if (updateTimer) clearTimeout(updateTimer);
			}

			if (spawnError) {
				output.unlink();
				throw new Error(`Failed to spawn command: ${spawnError.message}`);
			}

			if (exited) {
				signal?.removeEventListener("abort", onAbort);
				const { text, details } = formatShellOutput(output.readSlice(0), output.path);
				if (details) output.close();
				else output.unlink();
				if (signal?.aborted) {
					throw new Error(appendStatus(text, "Command aborted"));
				}
				if (exitCode !== 0 && exitCode !== null) {
					throw new Error(appendStatus(text, `Command exited with code ${exitCode}`));
				}
				return { content: [{ type: "text", text: text || "(no output)" }], details };
			}

			// Still running at the timeout: background it.
			backgrounded = true;
			signal?.removeEventListener("abort", onAbort);
			const record = registry.track({ command: params.command, pid: child.pid, output, exitPromise });
			const snapshot = registry.readAndAdvance(record);
			const { text, details } = formatShellOutput(snapshot, output.path);
			const status = `backgrounded as ${record.id} · still running. Poll with shell_command_status({"id": "${record.id}"}).`;
			return { content: [{ type: "text", text: appendStatus(text, status) }], details };
		},
		// Pi bash TUI verbatim: delegate to the builtin renderers, mapping args.
		renderCall(args: ShellCommandParams | undefined, theme, context) {
			const mapped = args
				? { command: args.command, timeout: args.timeout_ms !== undefined ? clampTimeoutMs(args.timeout_ms) / 1000 : undefined }
				: args;
			return bashToolBase.renderCall?.(mapped as any, theme, context as any);
		},
		renderResult(result, options, theme, context) {
			return bashToolBase.renderResult?.(result, options, theme, context as any);
		},
	} as ToolDefinition<any, any, any>;
}

export function registerShellCommand(pi: ExtensionAPI, registry: BackgroundShellRegistry): void {
	pi.registerTool(createShellCommandTool(registry));
}
