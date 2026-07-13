import { describe, expect, it } from "vitest";
import { createShellCancelTool } from "./cancel.ts";
import { createShellCommandTool } from "./command.ts";
import { BackgroundShellRegistry } from "./registry.ts";
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
		cancel: createShellCancelTool(registry),
	};
}

async function run(tool: any, params: object, onUpdate?: (update: any) => void) {
	return tool.execute("call-1", params, new AbortController().signal, onUpdate, ctx);
}

/** Background a command via the real shell_command tool; returns its id. */
async function background(command: any, cmd: string): Promise<string> {
	const result = await run(command, { command: cmd, timeout_ms: 200 });
	return result.content[0].text.match(/backgrounded as (shell-\d+)/)![1];
}

/** Wait until a pid is gone (SIGKILL delivery is async). */
async function waitForDeath(pid: number, timeoutMs = 2000): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			process.kill(pid, 0);
		} catch {
			return true;
		}
		await new Promise((r) => setTimeout(r, 50));
	}
	return false;
}

describe("shell_command_cancel", () => {
	it("renders cancellation as a compact shell-id row with expandable evidence", () => {
		const { cancel } = makeTools();
		const result = {
			content: [{ type: "text", text: "final output\n\ncancelled shell-1" }],
			details: { trace: { state: "cancelled" } },
		} as any;
		const context = { args: { id: "shell-1" }, cwd: "/work", isError: false } as any;

		expect(
			renderedLines(cancel.renderResult!(result, { expanded: false, isPartial: false }, theme, context)),
		).toEqual([" <warning>■</warning> <b>cancel</b> shell-1"]);
		expect(renderedLines(cancel.renderResult!(result, { expanded: true, isPartial: false }, theme, context))).toEqual(
			[
				" <warning>■</warning> <b>cancel</b> shell-1",
				" <toolOutput>final output</toolOutput>",
				" <toolOutput></toolOutput>",
				" <toolOutput>cancelled shell-1</toolOutput>",
			],
		);
	});

	it("emits running state before returning cancelled state", async () => {
		const { registry, cancel, command } = makeTools();
		const id = await background(command, "sleep 30");
		const updates: any[] = [];
		const result = await run(cancel, { id }, (update) => updates.push(update));
		expect(updates[0]?.details.trace).toEqual({ state: "running" });
		expect(result.details.trace).toEqual({ state: "cancelled" });
		expect(registry.get(id)).toBeUndefined();
	});

	it("kills the whole process group, including &-backgrounded descendants", async () => {
		const { registry, cancel, command } = makeTools();
		const id = await background(command, "sleep 30 & echo BG:$!; sleep 30");
		const record = registry.get(id)!;
		const snapshot = record.output.readSlice(0);
		const bgPid = Number(snapshot.match(/BG:(\d+)/)![1]);
		const parentPid = record.pid!;

		const result = await run(cancel, { id });
		expect(result.content[0].text).toContain(`cancelled ${id}`);
		// Whole tree dead: parent and the &-backgrounded descendant.
		expect(await waitForDeath(parentPid)).toBe(true);
		expect(await waitForDeath(bgPid)).toBe(true);
		// Cancel is the completing read: record deleted, second cancel errors.
		expect(registry.get(id)).toBeUndefined();
		await expect(run(cancel, { id })).rejects.toThrow(/no tracked background process/);
	});

	it("consumes the remainder since the last read (completing read)", async () => {
		const { registry, cancel, command, status } = makeTools();
		const id = await background(command, "echo early; sleep 0.6; echo late; sleep 30");
		await new Promise((r) => setTimeout(r, 700));
		const poll = await run(status, { id, timeout_ms: 0 });
		expect(poll.content[0].text).toContain("late");
		// Nothing new since the poll: cancel returns just the marker.
		const result = await run(cancel, { id });
		expect(result.content[0].text).not.toContain("late");
		expect(result.content[0].text).toContain(`cancelled ${id}`);
		expect(registry.get(id)).toBeUndefined();
	});

	it("preempts an in-flight status wait: status resolves non-error with cancelled, cancel takes the remainder", async () => {
		const { registry, cancel, command, status } = makeTools();
		const id = await background(command, "sleep 1; echo mid; sleep 30");
		// Status wait in flight (would otherwise run 10s).
		const pending = run(status, { id, timeout_ms: 10_000 });
		// Let "mid" land, then cancel — always accepted, never queued,
		// even while status holds the single-flight slot.
		await new Promise((r) => setTimeout(r, 1300));
		const cancelResult = await run(cancel, { id });
		// The in-flight wait resolves immediately, non-error, with
		// output-so-far + cancelled marker.
		const statusResult = await pending;
		expect(statusResult.content[0].text).toContain("mid");
		expect(statusResult.content[0].text).toContain("cancelled");
		expect(statusResult.details.trace).toEqual({ state: "cancelled" });
		// Cancel is the completing read: remainder only (status took "mid"),
		// record deleted.
		expect(cancelResult.content[0].text).not.toContain("mid");
		expect(cancelResult.content[0].text).toContain(`cancelled ${id}`);
		expect(registry.get(id)).toBeUndefined();
	});

	it("concurrent double-cancel: one completes, the other gets the unknown-id error", async () => {
		const { registry, cancel, command } = makeTools();
		const id = await background(command, "sleep 30");
		const results = await Promise.allSettled([run(cancel, { id }), run(cancel, { id })]);
		const fulfilled = results.filter((r) => r.status === "fulfilled");
		const rejected = results.filter((r) => r.status === "rejected");
		expect(fulfilled).toHaveLength(1);
		expect(rejected).toHaveLength(1);
		expect((fulfilled[0] as any).value.content[0].text).toContain(`cancelled ${id}`);
		expect((rejected[0] as any).reason.message).toMatch(/no tracked background process/);
		expect(registry.get(id)).toBeUndefined();
	});

	it("unknown id errors loudly with the live-id list", async () => {
		const { registry, command, cancel } = makeTools();
		const id = await background(command, "sleep 30");
		await expect(run(cancel, { id: "shell-99" })).rejects.toThrow(
			new RegExp(`no tracked background process "shell-99"[\\s\\S]*Live ids: ${id}`),
		);
		registry.killAll();
	});
});
