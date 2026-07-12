import { describe, expect, it, vi } from "vitest";
import type { AgentDefinition } from "./registry.ts";
import { SubagentRunner, type ChildSession } from "./runner.ts";

const definition: AgentDefinition = {
	key: "oracle",
	model: "openai-codex/gpt-5.6-sol",
	reasoningEffort: "high",
	systemPrompt: "Advise only.",
	tools: ["finder"],
	allowMcp: false,
};

function fakeChild(prompt: () => Promise<void>): ChildSession {
	return {
		sessionID: "child-7",
		prompt,
		finalMessage: () => "Final advice",
		abort: vi.fn(async () => {}),
		dispose: vi.fn(),
	};
}

describe("shared subagent runner", () => {
	it("maps input to the sole child message and returns its enveloped final message", async () => {
		const child = fakeChild(vi.fn(async () => {}));
		const create = vi.fn(async () => child);
		const processes = { killAll: vi.fn() };
		const runner = new SubagentRunner(create, () => processes);

		const result = await runner.run({
			definition,
			cwd: "/parent/worktree",
			input: { task: "check locking" },
			mapInput: ({ task }) => `Review: ${task}`,
		});

		expect(create).toHaveBeenCalledWith({ definition, cwd: "/parent/worktree", processes });
		expect(child.prompt).toHaveBeenCalledOnce();
		expect(child.prompt).toHaveBeenCalledWith("Review: check locking");
		expect(result).toBe('<oracle_result sessionID="child-7">\nFinal advice\n</oracle_result>');
		expect(processes.killAll).toHaveBeenCalledOnce();
		expect(child.dispose).toHaveBeenCalledOnce();
	});

	it("kills child processes after a hard error", async () => {
		const child = fakeChild(async () => { throw new Error("provider failed"); });
		const processes = { killAll: vi.fn() };
		const runner = new SubagentRunner(async () => child, () => processes);

		await expect(runner.run({ definition, cwd: "/tmp", input: "x", mapInput: String }))
			.rejects.toThrow("provider failed");
		expect(processes.killAll).toHaveBeenCalledOnce();
	});

	it("cascades parent abort without returning a partial envelope", async () => {
		const controller = new AbortController();
		let rejectPrompt!: (error: Error) => void;
		const child = fakeChild(() => new Promise<void>((_, reject) => { rejectPrompt = reject; }));
		vi.mocked(child.abort).mockImplementation(async () => rejectPrompt(new Error("aborted")));
		const processes = { killAll: vi.fn() };
		const runner = new SubagentRunner(async () => child, () => processes);

		const running = runner.run({ definition, cwd: "/tmp", input: "x", mapInput: String, signal: controller.signal });
		await Promise.resolve();
		controller.abort();

		await expect(running).rejects.toMatchObject({ name: "AbortError" });
		expect(child.abort).toHaveBeenCalledOnce();
		expect(processes.killAll).toHaveBeenCalledOnce();
	});
});
