import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";
import { type AgentToolSpec, createAgentTool } from "./agent-tool.ts";
import { type RunOptions, SubagentAbortError, SubagentRunError } from "./runner.ts";

interface ProbeParams {
	assignment: string;
	effort?: "standard" | "high";
}

function probeSpec(overrides: Partial<AgentToolSpec<ProbeParams, "task">> = {}): AgentToolSpec<ProbeParams, "task"> {
	return {
		key: "task",
		name: "probe",
		description: "Spine probe.",
		parameters: Type.Object({ assignment: Type.String() }),
		route: (params) => ({
			model: "openai-codex/gpt-5.6-sol",
			reasoning: params.effort === "high" ? "high" : "low",
		}),
		plan: (params) => ({ systemPrompt: "You are a probe.", message: `Do: ${params.assignment}` }),
		finalize: (answer) => ({ content: answer.toUpperCase() }),
		presentation: { action: "probe", target: (params) => params.assignment },
		tools: ["read"],
		allowMcp: false,
		...overrides,
	};
}

function fakeRun(answer: string) {
	return vi.fn(async (_options: RunOptions) => ({ sessionID: "probe-session", answer, toolLog: [] }));
}

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

describe("agent tool factory", () => {
	it("wraps the finalized answer in a session-attributed envelope", async () => {
		const run = fakeRun("all done");
		const tool = createAgentTool(probeSpec(), { run } as any);

		const result = await tool.execute("call", { assignment: "probe it" }, undefined, undefined, {
			cwd: "/repo",
		} as any);

		expect(result.content[0]).toEqual({
			type: "text",
			text: '<task_result sessionID="probe-session">\nALL DONE\n</task_result>',
		});
		expect(result.details).toEqual({ trace: { state: "success" } });
	});

	it("runs the planned assignment on the route supplied by the spec", async () => {
		const run = fakeRun("all done");
		const tool = createAgentTool(probeSpec(), { run } as any);

		await tool.execute("call", { assignment: "probe it" }, undefined, undefined, { cwd: "/repo" } as any);

		const options = run.mock.calls[0]?.[0];
		expect(options?.definition).toEqual({
			key: "task",
			model: "openai-codex/gpt-5.6-sol",
			reasoningEffort: "low",
			tools: ["read"],
			allowMcp: false,
			systemPrompt: "You are a probe.",
		});
		expect(options?.message).toBe("Do: probe it");
		expect(options?.cwd).toBe("/repo");
		expect(options).not.toHaveProperty("record");
	});

	it("attributes a persistent Subagent Record to its immediate caller", async () => {
		const run = fakeRun("all done");
		const tool = createAgentTool(probeSpec(), { run } as any);

		await tool.execute("call", { assignment: "  inspect\n durable   lineage  " }, undefined, undefined, {
			cwd: "/repo",
			sessionManager: { getSessionFile: () => "/sessions/parent.jsonl" },
		} as any);

		expect(run.mock.calls[0]?.[0].record).toEqual({
			parentSession: "/sessions/parent.jsonl",
			name: "task: inspect durable lineage",
		});
	});

	it("caps the complete Subagent Record name at 120 characters", async () => {
		const run = fakeRun("all done");
		const tool = createAgentTool(probeSpec(), { run } as any);

		await tool.execute("call", { assignment: "x".repeat(200) }, undefined, undefined, {
			cwd: "/repo",
			sessionManager: { getSessionFile: () => "/sessions/parent.jsonl" },
		} as any);

		expect(run.mock.calls[0]?.[0].record?.name).toBe(`task: ${"x".repeat(114)}`);
	});

	it("runs high-effort assignments on their supplied route", async () => {
		const run = fakeRun("all done");
		const tool = createAgentTool(probeSpec(), { run } as any);

		await tool.execute("call", { assignment: "probe it", effort: "high" }, undefined, undefined, {
			cwd: "/repo",
		} as any);

		expect(run.mock.calls[0]?.[0]?.definition).toMatchObject({
			model: "openai-codex/gpt-5.6-sol",
			reasoningEffort: "high",
		});
	});

	it("emits a running progress tally per child action", async () => {
		const run = vi.fn(async (options: RunOptions) => {
			options.onAction?.({ tool: "read", summary: "read ./one.ts" });
			options.onAction?.({ tool: "read", summary: "read ./two.ts" });
			return { sessionID: "probe-session", answer: "done", toolLog: [] };
		});
		const tool = createAgentTool(probeSpec(), { run } as any);
		const updates: any[] = [];

		await tool.execute("call", { assignment: "probe it" }, undefined, (update: any) => updates.push(update), {
			cwd: "/repo",
		} as any);

		expect(updates.map((update) => update.details)).toEqual([
			{ trace: { state: "running" }, actions: {}, calls: [] },
			{ trace: { state: "running" }, actions: { read: 1 }, calls: ["read ./one.ts"] },
			{
				trace: { state: "running" },
				actions: { read: 2 },
				calls: ["read ./one.ts", "read ./two.ts"],
			},
		]);
	});

	it("emits the running state before planning completes", async () => {
		const pendingPlan = deferred<{ systemPrompt: string; message: string }>();
		const spec = probeSpec({
			plan: () => pendingPlan.promise,
		});
		const updates: any[] = [];
		const tool = createAgentTool(spec, { run: fakeRun("done") } as any);

		const running = tool.execute(
			"call",
			{ assignment: "probe it" },
			undefined,
			(update: any) => updates.push(update),
			{ cwd: "/repo" } as any,
		);
		expect(updates.map((update) => update.details)).toEqual([
			{ trace: { state: "running" }, actions: {}, calls: [] },
		]);
		pendingPlan.resolve({ systemPrompt: "You are a probe.", message: "Do: probe it" });
		await running;
	});

	it("honors a pre-aborted signal without planning or running the child", async () => {
		const plan = vi.fn();
		const run = vi.fn();
		const controller = new AbortController();
		controller.abort();
		const tool = createAgentTool(probeSpec({ plan }), { run } as any);

		await expect(
			tool.execute("call", { assignment: "probe it" }, controller.signal, undefined, { cwd: "/repo" } as any),
		).rejects.toBeInstanceOf(SubagentAbortError);
		expect(plan).not.toHaveBeenCalled();
		expect(run).not.toHaveBeenCalled();
	});

	it("includes spec trace details in progress and success updates", async () => {
		const spec = probeSpec({
			traceDetails: () => ({ flavor: "salty" }),
		});
		const run = vi.fn(async (options: RunOptions) => {
			options.onAction?.({ tool: "read", summary: "read ./probe.ts" });
			return { sessionID: "probe-session", answer: "done", toolLog: [] };
		});
		const updates: any[] = [];
		const tool = createAgentTool(spec, { run } as any);
		const result = await tool.execute(
			"call",
			{ assignment: "probe it" },
			undefined,
			(update: any) => updates.push(update),
			{ cwd: "/repo" } as any,
		);

		expect(updates.map((update) => update.details)).toEqual([
			{ trace: { state: "running" }, flavor: "salty", actions: {}, calls: [] },
			{
				trace: { state: "running" },
				flavor: "salty",
				actions: { read: 1 },
				calls: ["read ./probe.ts"],
			},
		]);
		expect(result.details).toEqual({
			trace: { state: "success" },
			flavor: "salty",
			actions: { read: 1 },
			calls: ["read ./probe.ts"],
		});
	});

	it("includes spec trace details in recovered failures", async () => {
		const spec = probeSpec({
			traceDetails: () => ({ flavor: "salty" }),
			recover: () => ({ content: "salvaged", outcome: "cancelled" as const }),
		});

		const failure = new SubagentRunError("probe-session", [], new Error("boom"));
		const tool = createAgentTool(spec, { run: vi.fn().mockRejectedValue(failure) } as any);

		const recovered = await tool.execute("call", { assignment: "probe it" }, undefined, undefined, {
			cwd: "/repo",
		} as any);

		expect(recovered.details).toEqual({ trace: { state: "cancelled" }, flavor: "salty" });
	});

	it("annotates a finalize throw with the child session and log", async () => {
		const spec = probeSpec({
			finalize: () => {
				throw new Error("child returned an empty answer");
			},
		});
		const tool = createAgentTool(spec, { run: fakeRun("") } as any);

		const failure = await tool
			.execute("call", { assignment: "probe it" }, undefined, undefined, { cwd: "/repo" } as any)
			.then(
				() => undefined,
				(error: unknown) => error,
			);
		expect(failure).toBeInstanceOf(SubagentRunError);
		expect(failure).toMatchObject({
			sessionID: "probe-session",
			toolLog: [],
			message: "child returned an empty answer",
		});
	});

	it("rethrows run failures untouched when the spec has no recover hook", async () => {
		const failure = new SubagentRunError("probe-session", [], new Error("boom"));
		const tool = createAgentTool(probeSpec(), { run: vi.fn().mockRejectedValue(failure) } as any);

		await expect(
			tool.execute("call", { assignment: "probe it" }, undefined, undefined, { cwd: "/repo" } as any),
		).rejects.toBe(failure);
	});

	it("wraps a recover result as the error envelope with the recovered outcome", async () => {
		const failure = new SubagentRunError("probe-session", [], new Error("boom"));
		const recover = vi.fn(async () => ({ content: "salvaged report", outcome: "failed" as const }));
		const controller = new AbortController();
		const tool = createAgentTool(probeSpec({ recover }), { run: vi.fn().mockRejectedValue(failure) } as any);

		const result = await tool.execute("call", { assignment: "probe it" }, controller.signal, undefined, {
			cwd: "/repo",
		} as any);

		expect(recover).toHaveBeenCalledWith(failure, {
			params: { assignment: "probe it" },
			cwd: "/repo",
			signal: controller.signal,
		});
		expect(result.content[0]).toEqual({
			type: "text",
			text: '<task_error sessionID="probe-session">\nsalvaged report\n</task_error>',
		});
		expect(result.details).toEqual({ trace: { state: "failed" } });
	});

	it("lets recover rethrow a replacement error", async () => {
		const tool = createAgentTool(
			probeSpec({
				recover: () => {
					throw new Error("friendlier message");
				},
			}),
			{ run: vi.fn().mockRejectedValue(new Error("raw failure")) } as any,
		);

		await expect(
			tool.execute("call", { assignment: "probe it" }, undefined, undefined, { cwd: "/repo" } as any),
		).rejects.toThrow("friendlier message");
	});

	it("renders running action tallies in the presentation row", () => {
		const tool = createAgentTool(probeSpec(), { run: vi.fn() } as any);
		const theme = { fg: (_color: string, value: string) => value, bold: (value: string) => value } as any;
		const row = tool.renderCall?.({ assignment: "probe it" }, theme, { lastComponent: undefined } as any) as any;

		const running = tool.renderResult?.(
			{ content: [{ type: "text", text: "" }], details: { trace: { state: "running" }, actions: { read: 2 } } },
			{ expanded: false, isPartial: true },
			theme,
			{ args: { assignment: "probe it" }, cwd: "/repo", isError: false, lastComponent: row } as any,
		) as any;
		expect(running.render(100).map((line: string) => line.trimEnd())).toEqual([" ◐ probe probe it · read ×2"]);
	});

	it("wraps the assignment with hanging indentation and caps it at three lines", () => {
		const tool = createAgentTool(probeSpec(), { run: vi.fn() } as any);
		const theme = { fg: (_color: string, value: string) => value, bold: (value: string) => value } as any;
		const assignment = "one two three four five six seven eight nine";
		const component = tool.renderResult?.(
			{ content: [{ type: "text", text: "hidden" }], details: { trace: { state: "success" } } },
			{ expanded: false, isPartial: false },
			theme,
			{ args: { assignment }, cwd: "/repo", isError: false } as any,
		) as any;

		expect(component.render(24).map((line: string) => line.trimEnd())).toEqual([
			" ✓ probe one two three",
			"         four five six",
			"         seven eight …",
		]);
	});

	it("renders completed envelope evidence below the presentation row", () => {
		const tool = createAgentTool(probeSpec(), { run: vi.fn() } as any);
		const theme = { fg: (_color: string, value: string) => value, bold: (value: string) => value } as any;
		const row = tool.renderCall?.({ assignment: "probe it" }, theme, { lastComponent: undefined } as any) as any;

		const completed = tool.renderResult?.(
			{
				content: [{ type: "text", text: '<task_result sessionID="one">\nsalvage notes\n</task_result>' }],
				details: { trace: { state: "success" } },
			},
			{ expanded: true, isPartial: false },
			theme,
			{ args: { assignment: "probe it" }, cwd: "/repo", isError: false, lastComponent: row } as any,
		) as any;
		expect(completed.render(100).map((line: string) => line.trimEnd())).toEqual([
			" ✓ probe probe it",
			" salvage notes",
		]);
	});

	it("tails three child calls when collapsed and retains their aggregate after completion", () => {
		const tool = createAgentTool(probeSpec(), { run: vi.fn() } as any);
		const theme = { fg: (_color: string, value: string) => value, bold: (value: string) => value } as any;
		const component = tool.renderResult?.(
			{
				content: [{ type: "text", text: '<task_result sessionID="one">\ndone\n</task_result>' }],
				details: {
					trace: { state: "success" },
					actions: { read: 3, grep: 1 },
					calls: ["read ./one.ts", "read ./two.ts", "grep renderer", "read ./three.ts"],
				},
			},
			{ expanded: false, isPartial: false },
			theme,
			{ args: { assignment: "probe it" }, cwd: "/repo", isError: false } as any,
		) as any;

		expect(component.render(100).map((line: string) => line.trimEnd())).toEqual([
			" ✓ probe probe it · read ×3, grep ×1",
			"   read ./two.ts",
			"   grep renderer",
			"   read ./three.ts",
		]);
	});

	it("shows the full child call history before the final answer when expanded", () => {
		const tool = createAgentTool(probeSpec(), { run: vi.fn() } as any);
		const theme = { fg: (_color: string, value: string) => value, bold: (value: string) => value } as any;
		const component = tool.renderResult?.(
			{
				content: [{ type: "text", text: '<task_result sessionID="one">\nfinal answer\n</task_result>' }],
				details: {
					trace: { state: "success" },
					actions: { read: 4 },
					calls: ["read ./one.ts", "read ./two.ts", "read ./three.ts", "read ./four.ts"],
				},
			},
			{ expanded: true, isPartial: false },
			theme,
			{ args: { assignment: "probe it" }, cwd: "/repo", isError: false } as any,
		) as any;

		expect(component.render(100).map((line: string) => line.trimEnd())).toEqual([
			" ✓ probe probe it · read ×4",
			"   read ./one.ts",
			"   read ./two.ts",
			"   read ./three.ts",
			"   read ./four.ts",
			" final answer",
		]);
	});
});
