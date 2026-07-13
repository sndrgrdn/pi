import type { Model } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { type AgentDefinition, type ChildSession, resolveConfiguredModel, SubagentRunner } from "./runner.ts";
import { BackgroundShellRegistry } from "./shell/registry.ts";

const definition: AgentDefinition = {
	key: "oracle",
	model: "openai-codex/gpt-5.6-sol",
	reasoningEffort: "high",
	systemPrompt: "Advise only.",
	tools: ["finder"],
	allowMcp: false,
};

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function fakeChild(prompt: () => Promise<void>, sessionID = "child-7") {
	const processes = new BackgroundShellRegistry();
	vi.spyOn(processes, "killAll");
	return {
		sessionID,
		processes,
		prompt,
		finalMessage: () => "Final advice",
		abort: vi.fn(async () => {}),
		dispose: vi.fn(),
		toolLog: () => [],
	} satisfies ChildSession;
}

describe("shared subagent runner", () => {
	it("prompts the sole child message and returns the attributed run result", async () => {
		const child = fakeChild(vi.fn(async () => {}));
		const create = vi.fn(async () => child);
		const runner = new SubagentRunner(create);

		const result = await runner.run({
			definition,
			cwd: "/parent/worktree",
			message: "Review: check locking",
		});

		expect(create).toHaveBeenCalledWith({ definition, cwd: "/parent/worktree" });
		expect(child.prompt).toHaveBeenCalledWith("Review: check locking");
		expect(result).toEqual({ sessionID: "child-7", answer: "Final advice", toolLog: [] });
		expect(child.processes.killAll).toHaveBeenCalledOnce();
		expect(child.dispose).toHaveBeenCalledOnce();
	});

	it("kills child processes after a hard error", async () => {
		const child = fakeChild(async () => {
			throw new Error("provider failed");
		});
		const runner = new SubagentRunner(async () => child);

		await expect(runner.run({ definition, cwd: "/tmp", message: "x" })).rejects.toThrow("provider failed");
		expect(child.processes.killAll).toHaveBeenCalledOnce();
	});

	it("cascades parent abort without returning a partial envelope", async () => {
		const controller = new AbortController();
		const promptStarted = deferred<void>();
		const pendingPrompt = deferred<void>();
		const child = fakeChild(() => {
			promptStarted.resolve();
			return pendingPrompt.promise;
		});
		vi.mocked(child.abort).mockImplementation(async () => pendingPrompt.reject(new Error("aborted")));
		const runner = new SubagentRunner(async () => child);

		const running = runner.run({
			definition,
			cwd: "/tmp",
			message: "x",
			signal: controller.signal,
		});
		await promptStarted.promise;
		controller.abort();

		await expect(running).rejects.toMatchObject({ name: "AbortError", sessionID: "child-7", toolLog: [] });
		expect(child.abort).toHaveBeenCalledOnce();
		expect(child.processes.killAll).toHaveBeenCalledOnce();
	});

	it("honors an abort that arrives while the child session is being created", async () => {
		const controller = new AbortController();
		const child = fakeChild(vi.fn(async () => {}));
		const pendingChild = deferred<ChildSession>();
		const create = () => pendingChild.promise;
		const runner = new SubagentRunner(create);

		const running = runner.run({
			definition,
			cwd: "/tmp",
			message: "x",
			signal: controller.signal,
		});
		controller.abort();
		pendingChild.resolve(child);

		await expect(running).rejects.toMatchObject({ name: "AbortError" });
		expect(child.abort).toHaveBeenCalledOnce();
		expect(child.prompt).not.toHaveBeenCalled();
		expect(child.processes.killAll).toHaveBeenCalledOnce();
	});

	it("keeps concurrent calls isolated on one runner instance", async () => {
		const children = {
			a: fakeChild(
				vi.fn(async () => {}),
				"child-a",
			),
			b: fakeChild(
				vi.fn(async () => {}),
				"child-b",
			),
		};
		const runner = new SubagentRunner(vi.fn(async ({ definition: _definition, cwd }) => children[cwd as "a" | "b"]));
		const run = (message: "a" | "b") => runner.run({ definition, cwd: message, message });

		const results = await Promise.all([run("a"), run("b")]);
		expect(results).toEqual([
			{ sessionID: "child-a", answer: "Final advice", toolLog: [] },
			{ sessionID: "child-b", answer: "Final advice", toolLog: [] },
		]);
		for (const child of Object.values(children)) expect(child.processes.killAll).toHaveBeenCalledOnce();
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
		expect(() => resolveConfiguredModel({ find: () => undefined }, "custom/missing")).toThrow(
			'resolved model "custom/missing" is not configured',
		);
	});
});
