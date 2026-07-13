import { describe, expect, it, vi } from "vitest";
import type { Model } from "@earendil-works/pi-ai";
import type { AgentDefinition } from "./registry.ts";
import { resolveConfiguredModel, SubagentRunner, type ChildSession } from "./runner.ts";
import { BackgroundShellRegistry } from "./shell/registry.ts";
import { buildEnvelope } from "./envelopes.ts";

const definition: AgentDefinition = {
	key: "oracle",
	model: "openai-codex/gpt-5.6-sol",
	reasoningEffort: "high",
	systemPrompt: "Advise only.",
	tools: ["finder"],
	allowMcp: false,
};

function fakeChild(prompt: () => Promise<void>) {
	const processes = new BackgroundShellRegistry();
	vi.spyOn(processes, "killAll");
	return {
		sessionID: "child-7",
		processes,
		prompt,
		finalMessage: () => "Final advice",
		abort: vi.fn(async () => {}),
		dispose: vi.fn(),
	} satisfies ChildSession;
}

describe("shared subagent runner", () => {
	it("maps input to the sole child message and returns its enveloped final message", async () => {
		const child = fakeChild(vi.fn(async () => {}));
		const create = vi.fn(async () => child);
		const runner = new SubagentRunner(create);

		const result = await runner.run({
			definition,
			cwd: "/parent/worktree",
			input: { task: "check locking" },
			mapInput: ({ task }) => `Review: ${task}`,
			wrapResult: (sessionID, content) => buildEnvelope({ kind: "oracle", sessionID, content }),
		});

		expect(create).toHaveBeenCalledWith({ definition, cwd: "/parent/worktree" });
		expect(child.prompt).toHaveBeenCalledWith("Review: check locking");
		expect(result).toBe('<oracle_result sessionID="child-7">\nFinal advice\n</oracle_result>');
		expect(child.processes.killAll).toHaveBeenCalledOnce();
		expect(child.dispose).toHaveBeenCalledOnce();
	});

	it("kills child processes after a hard error", async () => {
		const child = fakeChild(async () => { throw new Error("provider failed"); });
		const runner = new SubagentRunner(async () => child);

		await expect(runner.run({ definition, cwd: "/tmp", input: "x", mapInput: String, wrapResult: () => "unused" }))
			.rejects.toThrow("provider failed");
		expect(child.processes.killAll).toHaveBeenCalledOnce();
	});

	it("cascades parent abort without returning a partial envelope", async () => {
		const controller = new AbortController();
		let rejectPrompt!: (error: Error) => void;
		const child = fakeChild(() => new Promise<void>((_, reject) => { rejectPrompt = reject; }));
		vi.mocked(child.abort).mockImplementation(async () => rejectPrompt(new Error("aborted")));
		const runner = new SubagentRunner(async () => child);

		const running = runner.run({
			definition, cwd: "/tmp", input: "x", mapInput: String, wrapResult: () => "unused", signal: controller.signal,
		});
		await Promise.resolve();
		controller.abort();

		await expect(running).rejects.toMatchObject({ name: "AbortError" });
		expect(child.abort).toHaveBeenCalledOnce();
		expect(child.processes.killAll).toHaveBeenCalledOnce();
	});

	it("honors an abort that arrives while the child session is being created", async () => {
		const controller = new AbortController();
		const child = fakeChild(vi.fn(async () => {}));
		let finishCreate!: () => void;
		const create = () => new Promise<ChildSession>((resolve) => {
			finishCreate = () => resolve(child);
		});
		const runner = new SubagentRunner(create);

		const running = runner.run({
			definition, cwd: "/tmp", input: "x", mapInput: String, wrapResult: () => "unused", signal: controller.signal,
		});
		controller.abort();
		finishCreate();

		await expect(running).rejects.toMatchObject({ name: "AbortError" });
		expect(child.abort).toHaveBeenCalledOnce();
		expect(child.prompt).not.toHaveBeenCalled();
		expect(child.processes.killAll).toHaveBeenCalledOnce();
	});

	it("keeps concurrent calls isolated on one runner instance", async () => {
		const children = [
			fakeChild(vi.fn(async () => {})),
			fakeChild(vi.fn(async () => {})),
		];
		children[0]!.sessionID = "child-a";
		children[1]!.sessionID = "child-b";
		const allChildren = [...children];
		const runner = new SubagentRunner(vi.fn(async () => children.shift()!));
		const run = (input: string) => runner.run({
			definition, cwd: "/tmp", input, mapInput: String,
			wrapResult: (sessionID, content) => `${sessionID}:${content}`,
		});

		await expect(Promise.all([run("a"), run("b")])).resolves.toEqual([
			"child-a:Final advice", "child-b:Final advice",
		]);
		for (const child of allChildren) expect(child.processes.killAll).toHaveBeenCalledOnce();
	});
});

describe("resolved child model", () => {
	it("uses the configured model registry rather than the built-in model catalog", () => {
		const customModel = { provider: "custom", id: "local-model" } as Model<any>;
		const registry = { find: vi.fn(() => customModel) };

		expect(resolveConfiguredModel(registry, "custom/local-model")).toBe(customModel);
		expect(registry.find).toHaveBeenCalledWith("custom", "local-model");
	});

	it("fails at the boundary for an unconfigured model", () => {
		expect(() => resolveConfiguredModel({ find: () => undefined }, "custom/missing"))
			.toThrow('resolved model "custom/missing" is not configured');
	});
});
