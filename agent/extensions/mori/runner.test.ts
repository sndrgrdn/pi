import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type AgentDefinition,
	type ChildSession,
	createSubagentSessionManager,
	resolveConfiguredModel,
	SubagentRunner,
} from "./runner.ts";
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
			record: { parentSession: "/sessions/parent.jsonl", name: "oracle: check locking" },
		});

		expect(create).toHaveBeenCalledWith({
			definition,
			cwd: "/parent/worktree",
			record: { parentSession: "/sessions/parent.jsonl", name: "oracle: check locking" },
		});
		expect(child.prompt).toHaveBeenCalledWith("Review: check locking");
		expect(result).toEqual({ sessionID: "child-7", answer: "Final advice", toolLog: [] });
		expect(child.processes.killAll).toHaveBeenCalledOnce();
		expect(child.dispose).toHaveBeenCalledOnce();
	});

	it("requires a final message by default", async () => {
		const child = { ...fakeChild(vi.fn(async () => {})), finalMessage: () => undefined };
		const runner = new SubagentRunner(async () => child);

		await expect(runner.run({ definition, cwd: "/tmp", message: "x" })).rejects.toMatchObject({
			sessionID: "child-7",
			message: "oracle child returned no final message",
		});
	});

	it("allows a terminating-tool child to omit its final message explicitly", async () => {
		const child = { ...fakeChild(vi.fn(async () => {})), finalMessage: () => undefined };
		const runner = new SubagentRunner(async () => child);

		await expect(runner.run({ definition, cwd: "/tmp", message: "x", finalMessage: "optional" })).resolves.toEqual({
			sessionID: "child-7",
			answer: "",
			toolLog: [],
		});
	});

	it("sends one follow-up prompt in the same session when needed() reports the capture is missing", async () => {
		const prompts: string[] = [];
		let captured = false;
		const child = fakeChild(
			vi.fn(async (...args: unknown[]) => {
				prompts.push(args[0] as string);
				if (prompts.length === 2) captured = true;
			}),
		);
		const runner = new SubagentRunner(async () => child);

		const result = await runner.run({
			definition,
			cwd: "/tmp",
			message: "Review the diff",
			finalMessage: "optional",
			followUp: { message: "Submit now.", needed: () => !captured },
		});

		expect(prompts).toEqual(["Review the diff", "Submit now."]);
		expect(result.sessionID).toBe("child-7");
	});

	it("skips the follow-up prompt when the capture is already satisfied", async () => {
		const child = fakeChild(vi.fn(async () => {}));
		const runner = new SubagentRunner(async () => child);

		await runner.run({
			definition,
			cwd: "/tmp",
			message: "Review the diff",
			followUp: { message: "Submit now.", needed: () => false },
		});

		expect(child.prompt).toHaveBeenCalledExactlyOnceWith("Review the diff");
	});

	it("does not hide provider errors when the final message is optional", async () => {
		const child = fakeChild(async () => {
			throw new Error("provider failed");
		});
		const runner = new SubagentRunner(async () => child);

		await expect(runner.run({ definition, cwd: "/tmp", message: "x", finalMessage: "optional" })).rejects.toThrow(
			"provider failed",
		);
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
	it("resolves a built-in model through the current Pi model runtime", async () => {
		const runtime = await ModelRuntime.create({ modelsPath: null });

		expect(resolveConfiguredModel(runtime, "openai-codex/gpt-5.6-sol")).toMatchObject({
			provider: "openai-codex",
			id: "gpt-5.6-sol",
		});
	});

	it("uses the configured model runtime rather than a separate model catalog", () => {
		const customModel = { provider: "custom", id: "local-model" } as Model<any>;
		const runtime = { getModel: vi.fn(() => customModel) };

		expect(resolveConfiguredModel(runtime, "custom/local-model")).toBe(customModel);
		expect(runtime.getModel).toHaveBeenCalledWith("custom", "local-model");
	});

	it("fails at the boundary for an unconfigured model", () => {
		expect(() => resolveConfiguredModel({ getModel: () => undefined }, "custom/missing")).toThrow(
			'resolved model "custom/missing" is not configured',
		);
	});
});

describe("Subagent Record session boundary", () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	it("creates a named native session linked to the immediate caller", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "subagent-record-"));
		dirs.push(agentDir);

		const session = createSubagentSessionManager(
			{
				cwd: "/repo",
				record: { parentSession: "/sessions/parent.jsonl", name: "oracle: check locking" },
			},
			agentDir,
		);

		expect(session.isPersisted()).toBe(true);
		expect(session.getSessionDir()).toBe(join(agentDir, "sessions", "subagent"));
		expect(session.getHeader()).toMatchObject({ parentSession: "/sessions/parent.jsonl" });
		expect(session.getSessionName()).toBe("oracle: check locking");
		expect(session.getSessionFile()).not.toBe("/sessions/parent.jsonl");
	});

	it("keeps the Subagent ephemeral when its caller has no session file", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "subagent-record-"));
		dirs.push(agentDir);

		const session = createSubagentSessionManager({ cwd: "/repo" }, agentDir);

		expect(session.isPersisted()).toBe(false);
		expect(session.getSessionFile()).toBeUndefined();
		expect(session.getSessionName()).toBeUndefined();
	});
});
