import { describe, expect, it } from "vitest";
import { createShellCommandTool } from "./command.ts";
import { BackgroundShellRegistry } from "./registry.ts";

const ctx = { cwd: process.cwd() } as any;

function makeTool(registry = new BackgroundShellRegistry()) {
	return { tool: createShellCommandTool(registry), registry };
}

async function run(tool: any, params: object, signal?: AbortSignal) {
	return tool.execute("call-1", params, signal ?? new AbortController().signal, undefined, ctx);
}

describe("shell_command", () => {
	it("returns output for a completed exit-0 command", async () => {
		const { tool } = makeTool();
		const result = await run(tool, { command: "echo hello" });
		expect(result.content[0].text).toBe("hello");
	});

	it("nonzero exit on a completed run is a tool error with output", async () => {
		const { tool } = makeTool();
		await expect(run(tool, { command: "echo oops >&2; exit 7" })).rejects.toThrow(
			/oops[\s\S]*Command exited with code 7/,
		);
	});

	it("nonexistent workdir errors immediately", async () => {
		const { tool } = makeTool();
		await expect(run(tool, { command: "true", workdir: "/nonexistent/nope" })).rejects.toThrow(
			/Working directory does not exist/,
		);
	});

	it("backgrounds a still-running command at the timeout with id + poll instruction", async () => {
		const { tool, registry } = makeTool();
		const result = await run(tool, { command: "echo started; sleep 30", timeout_ms: 300 });
		const text = result.content[0].text;
		expect(text).toContain("started");
		expect(text).toContain("backgrounded as shell-1 · still running");
		expect(text).toContain("shell_command_status");
		const record = registry.get("shell-1");
		expect(record).toBeDefined();
		expect(record!.exited).toBe(false);
		// Backgrounding snapshot advanced the shared cursor: nothing new yet.
		expect(registry.readAndAdvance(record!)).toBe("");
		registry.killAll();
	});

	it("backgrounded processes survive turn aborts; foreground abort kills", async () => {
		const { tool, registry } = makeTool();
		const controller = new AbortController();
		await run(tool, { command: "sleep 30", timeout_ms: 100 }, controller.signal);
		controller.abort();
		await new Promise((r) => setTimeout(r, 100));
		const record = registry.get("shell-1")!;
		expect(record.exited).toBe(false);
		expect(() => process.kill(record.pid!, 0)).not.toThrow(); // still alive
		registry.killAll();

		// Foreground abort: process dies, tool errors.
		const fg = new AbortController();
		const pending = run(tool, { command: "sleep 30", timeout_ms: 5000 }, fg.signal);
		setTimeout(() => fg.abort(), 100);
		await expect(pending).rejects.toThrow(/Command aborted/);
	});

	it("runs fully concurrent background processes with distinct ids", async () => {
		const { tool, registry } = makeTool();
		const [a, b] = await Promise.all([
			run(tool, { command: "sleep 30", timeout_ms: 100 }),
			run(tool, { command: "sleep 30", timeout_ms: 100 }),
		]);
		const ids = [a, b].map((r: any) => r.content[0].text.match(/backgrounded as (shell-\d+)/)![1]);
		expect(new Set(ids).size).toBe(2);
		registry.killAll();
	});
});
