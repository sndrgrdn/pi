import { describe, expect, it } from "vitest";
import { createShellCommandTool } from "./command.ts";
import { BackgroundShellRegistry, SWEEP_AFTER_MS } from "./registry.ts";
import { createShellStatusTool } from "./status.ts";

const ctx = { cwd: process.cwd() } as any;
const theme = {
	fg: (color: string, value: string) => `<${color}>${value}</${color}>`,
	bold: (value: string) => `<b>${value}</b>`,
} as any;

function renderedLines(component: { render(width: number): string[] }): string[] {
	return component.render(200).map((line) => line.trimEnd());
}

function makeTools() {
	const registry = new BackgroundShellRegistry();
	return {
		registry,
		command: createShellCommandTool(registry),
		status: createShellStatusTool(registry),
	};
}

async function run(tool: any, params: object, onUpdate?: (u: any) => void) {
	return tool.execute("call-1", params, new AbortController().signal, onUpdate, ctx);
}

/** Background a command via the real shell_command tool; returns its id. */
async function background(command: any, cmd: string): Promise<string> {
	const result = await run(command, { command: cmd, timeout_ms: 200 });
	return result.content[0].text.match(/backgrounded as (shell-\d+)/)![1];
}

describe("shell_command_status", () => {
	it("renders polling as a compact shell-id row with expandable evidence", () => {
		const { status } = makeTools();
		const result = {
			content: [{ type: "text", text: "new output\n\nshell-1 · still running" }],
			details: { trace: { state: "success", qualifiers: ["still running"] } },
		} as any;
		const context = { args: { id: "shell-1" }, cwd: "/work", isError: false } as any;

		expect(
			renderedLines(status.renderResult!(result, { expanded: false, isPartial: false }, theme, context)),
		).toEqual([" <success>✓</success> <b>poll</b> shell-1 · <muted>still running</muted>"]);
		expect(renderedLines(status.renderResult!(result, { expanded: true, isPartial: false }, theme, context))).toEqual(
			[
				" <success>✓</success> <b>poll</b> shell-1 · <muted>still running</muted>",
				" <toolOutput>new output</toolOutput>",
				" <toolOutput></toolOutput>",
				" <toolOutput>shell-1 · still running</toolOutput>",
			],
		);
	});

	it("emits running state immediately", async () => {
		const { registry, command, status } = makeTools();
		const id = await background(command, "sleep 30");
		const updates: any[] = [];
		await run(status, { id, timeout_ms: 0 }, (update) => updates.push(update));
		expect(updates[0]?.details.trace).toEqual({ state: "running" });
		registry.killAll();
	});

	it("second poll sees only output produced since the first (lossless cursor)", async () => {
		const { registry, command, status } = makeTools();
		const id = await background(command, "echo first; sleep 0.6; echo second; sleep 30");
		// First poll: snapshot already consumed "first" at backgrounding? No —
		// "first" printed before the 200ms background cutoff, so the snapshot
		// took it. Wait for "second", then poll.
		await new Promise((r) => setTimeout(r, 700));
		const first = await run(status, { id, timeout_ms: 0 });
		expect(first.content[0].text).toContain("second");
		expect(first.content[0].text).not.toContain("first");
		// Nothing new since: second poll is empty.
		const second = await run(status, { id, timeout_ms: 0 });
		expect(second.content[0].text).not.toContain("second");
		expect(second.content[0].text).toContain("still running");
		registry.killAll();
	});

	it("completing read reports exit 0 exactly once and deletes the record", async () => {
		const { registry, command, status } = makeTools();
		const id = await background(command, "sleep 0.5; echo done");
		const result = await run(status, { id, timeout_ms: 5000 });
		const text = result.content[0].text;
		expect(text).toContain("done");
		expect(text).toContain("exited 0");
		expect(result.details.trace).toEqual({ state: "success" });
		expect(registry.get(id)).toBeUndefined();
		// Subsequent poll: unknown-id error listing live ids.
		await expect(run(status, { id, timeout_ms: 0 })).rejects.toThrow(
			/no tracked background process "shell-1"[\s\S]*Live ids: none/,
		);
	});

	it("nonzero exit surfaces as a tool error on the completing read", async () => {
		const { registry, command, status } = makeTools();
		const id = await background(command, "sleep 0.5; echo oops >&2; exit 7");
		await expect(run(status, { id, timeout_ms: 5000 })).rejects.toThrow(/oops[\s\S]*exited 7/);
		expect(registry.get(id)).toBeUndefined();
	});

	it("preserves signal termination as a successful completing read", async () => {
		const { registry, command, status } = makeTools();
		const id = await background(command, "sleep 30");
		const record = registry.get(id)!;
		process.kill(process.platform === "win32" ? record.pid! : -record.pid!, "SIGKILL");
		await expect(run(status, { id, timeout_ms: 5000 })).resolves.toMatchObject({
			content: [{ text: expect.stringMatching(/exited \(signal\)/) }],
		});
		expect(registry.get(id)).toBeUndefined();
	});

	it("allow_nonzero carries over to the background completing read", async () => {
		const { registry, command, status } = makeTools();
		const start = await run(command, {
			command: "sleep 0.5; echo oops >&2; exit 7",
			timeout_ms: 100,
			allow_nonzero: true,
		});
		const id = start.content[0].text.match(/backgrounded as (shell-\d+)/)![1];
		await expect(run(status, { id, timeout_ms: 5000 })).resolves.toMatchObject({
			content: [{ text: expect.stringMatching(/oops[\s\S]*exited 7/) }],
		});
		expect(registry.get(id)).toBeUndefined();
	});

	it("polls multiple ids in one call, waiting for all and reporting each section", async () => {
		const { registry, command, status } = makeTools();
		const a = await background(command, "sleep 0.5; echo alpha");
		const b = await background(command, "sleep 0.5; echo beta");
		const result = await run(status, { id: [a, b], timeout_ms: 5000 });
		expect(result.content[0].text).toMatch(
			new RegExp(`alpha[\\s\\S]*${a} · exited 0[\\s\\S]*beta[\\s\\S]*${b} · exited 0`),
		);
		expect(result.details.trace).toEqual({ state: "success", qualifiers: ["2 exited"] });
		expect(registry.get(a)).toBeUndefined();
		expect(registry.get(b)).toBeUndefined();
	});

	it("multi-id read with one disallowed nonzero fails with every section included", async () => {
		const { registry, command, status } = makeTools();
		const a = await background(command, "sleep 0.5; echo good");
		const b = await background(command, "sleep 0.5; echo bad >&2; exit 3");
		await expect(run(status, { id: [a, b], timeout_ms: 5000 })).rejects.toThrow(
			new RegExp(`good[\\s\\S]*${a} · exited 0[\\s\\S]*bad[\\s\\S]*${b} · exited 3`),
		);
		// Both completing reads consumed exactly once.
		expect(registry.get(a)).toBeUndefined();
		expect(registry.get(b)).toBeUndefined();
	});

	it("unknown id in a multi-id call fails before any read is acquired", async () => {
		const { registry, command, status } = makeTools();
		const a = await background(command, "sleep 30");
		await expect(run(status, { id: [a, "shell-99"], timeout_ms: 0 })).rejects.toThrow(
			/no tracked background process "shell-99"/,
		);
		// The valid id holds no leaked in-flight read and polls normally.
		const result = await run(status, { id: a, timeout_ms: 0 });
		expect(result.content[0].text).toContain(`${a} · still running`);
		registry.killAll();
	});

	it("timeout_ms 0 returns an instant snapshot of a still-running process", async () => {
		const { registry, command, status } = makeTools();
		const id = await background(command, "sleep 30");
		const started = Date.now();
		const result = await run(status, { id, timeout_ms: 0 });
		expect(Date.now() - started).toBeLessThan(500);
		expect(result.content[0].text).toContain("still running");
		expect(result.details.trace).toEqual({ state: "success", qualifiers: ["still running"] });
		expect(registry.get(id)).toBeDefined();
		registry.killAll();
	});

	it("rejects a concurrent same-id read (single-flight)", async () => {
		const { registry, command, status } = makeTools();
		const id = await background(command, "sleep 30");
		const pending = run(status, { id, timeout_ms: 1000 });
		await expect(run(status, { id, timeout_ms: 0 })).rejects.toThrow(/read already in flight/);
		await pending;
		// Flight released: a fresh read succeeds.
		await run(status, { id, timeout_ms: 0 });
		registry.killAll();
	});

	it("unknown id errors loudly with the live-id list", async () => {
		const { registry, command, status } = makeTools();
		const id = await background(command, "sleep 30");
		await expect(run(status, { id: "shell-99" })).rejects.toThrow(
			new RegExp(`no tracked background process "shell-99"[\\s\\S]*Live ids: ${id}`),
		);
		registry.killAll();
	});

	it("sweeps exited-but-unpolled records older than 1h at call start", async () => {
		const { registry, command, status } = makeTools();
		const stale = await background(command, "sleep 0.3");
		const live = await background(command, "sleep 30");
		await new Promise((r) => setTimeout(r, 500));
		const record = registry.get(stale)!;
		expect(record.exited).toBe(true);
		// Age the record past the sweep horizon.
		record.exitedAt = Date.now() - SWEEP_AFTER_MS - 1000;
		record.lastPolledAt = record.exitedAt;
		await expect(run(status, { id: stale, timeout_ms: 0 })).rejects.toThrow(
			new RegExp(`no tracked background process "${stale}"[\\s\\S]*Live ids: ${live}`),
		);
		registry.killAll();
	});

	it("streams new output as progress updates during the wait", async () => {
		const { registry, command, status } = makeTools();
		const id = await background(command, "sleep 0.5; echo streamed; sleep 30");
		const updates: string[] = [];
		await run(status, { id, timeout_ms: 1200 }, (u: any) => updates.push(u.content[0].text));
		expect(updates.some((t) => t.includes("streamed"))).toBe(true);
		registry.killAll();
	});
});
