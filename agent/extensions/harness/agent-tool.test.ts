import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";
import { type AgentToolSpec, createAgentTool } from "./agent-tool.ts";
import { BUILTIN_PROFILES } from "./profiles.ts";
import { type RunOptions, SubagentRunError } from "./runner.ts";

interface ProbeParams {
	assignment: string;
	mode?: "low" | "high";
}

function probeSpec(overrides: Partial<AgentToolSpec<ProbeParams>> = {}): AgentToolSpec<ProbeParams> {
	return {
		key: "task",
		name: "probe",
		description: "Spine probe.",
		parameters: Type.Object({ assignment: Type.String() }),
		mode: (params) => params.mode ?? "low",
		plan: (params) => ({ systemPrompt: "You are a probe.", message: `Do: ${params.assignment}` }),
		finalize: (answer) => ({ content: answer.toUpperCase() }),
		presentation: { action: "probe", target: (params) => params.assignment },
		tools: ["read"],
		allowMcp: false,
		...overrides,
	};
}

function fakeRun(answer: string) {
	return vi.fn(async (options: RunOptions<ProbeParams>) => options.wrapResult("probe-session", answer));
}

describe("agent tool factory", () => {
	it("dispatches mode to a per-call route and wraps the finalized answer in the envelope", async () => {
		const run = fakeRun("all done");
		const tool = createAgentTool(probeSpec(), { run } as any, BUILTIN_PROFILES);

		const result = await tool.execute("call", { assignment: "probe it" }, undefined, undefined, {
			cwd: "/repo",
		} as any);

		expect(result.content[0]).toEqual({
			type: "text",
			text: '<task_result sessionID="probe-session">\nALL DONE\n</task_result>',
		});
		expect(result.details).toEqual({ trace: { state: "success" } });
		const options = run.mock.calls[0]?.[0];
		expect(options?.definition).toMatchObject({
			key: "task",
			model: "openai-codex/gpt-5.6-sol",
			reasoningEffort: "low",
			tools: ["read"],
			allowMcp: false,
			systemPrompt: "You are a probe.",
		});
		expect(options?.mapInput({ assignment: "probe it" })).toBe("Do: probe it");
		expect(options?.cwd).toBe("/repo");

		await tool.execute("call-2", { assignment: "probe it", mode: "high" }, undefined, undefined, {
			cwd: "/repo",
		} as any);
		expect(run.mock.calls[1]?.[0]?.definition).toMatchObject({
			model: "anthropic/claude-fable-5",
			reasoningEffort: "high",
		});
	});

	it("emits a running progress tally per child action", async () => {
		const run = vi.fn(async (options: RunOptions<ProbeParams>) => {
			options.onAction?.("read");
			options.onAction?.("read");
			return options.wrapResult("probe-session", "done");
		});
		const tool = createAgentTool(probeSpec(), { run } as any, BUILTIN_PROFILES);
		const updates: any[] = [];

		await tool.execute("call", { assignment: "probe it" }, undefined, (update: any) => updates.push(update), {
			cwd: "/repo",
		} as any);

		expect(updates.map((update) => update.details)).toEqual([
			{ trace: { state: "running" }, actions: {} },
			{ trace: { state: "running" }, actions: { read: 1 } },
			{ trace: { state: "running" }, actions: { read: 2 } },
		]);
	});

	it("propagates a finalize throw as the tool failure", async () => {
		const spec = probeSpec({
			finalize: () => {
				throw new Error("child returned an empty answer");
			},
		});
		const tool = createAgentTool(spec, { run: fakeRun("") } as any, BUILTIN_PROFILES);

		await expect(
			tool.execute("call", { assignment: "probe it" }, undefined, undefined, { cwd: "/repo" } as any),
		).rejects.toThrow("child returned an empty answer");
	});

	it("rethrows run failures untouched when the spec has no recover hook", async () => {
		const failure = new SubagentRunError("probe-session", [], new Error("boom"));
		const tool = createAgentTool(probeSpec(), { run: vi.fn().mockRejectedValue(failure) } as any, BUILTIN_PROFILES);

		await expect(
			tool.execute("call", { assignment: "probe it" }, undefined, undefined, { cwd: "/repo" } as any),
		).rejects.toBe(failure);
	});

	it("wraps a recover result as the error envelope with the recovered outcome", async () => {
		const failure = new SubagentRunError("probe-session", [], new Error("boom"));
		const recover = vi.fn(async () => ({ content: "salvaged report", outcome: "failed" as const }));
		const tool = createAgentTool(
			probeSpec({ recover }),
			{ run: vi.fn().mockRejectedValue(failure) } as any,
			BUILTIN_PROFILES,
		);

		const result = await tool.execute("call", { assignment: "probe it" }, undefined, undefined, {
			cwd: "/repo",
		} as any);

		expect(recover).toHaveBeenCalledWith(failure);
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
			BUILTIN_PROFILES,
		);

		await expect(
			tool.execute("call", { assignment: "probe it" }, undefined, undefined, { cwd: "/repo" } as any),
		).rejects.toThrow("friendlier message");
	});

	it("renders the presentation row with running tallies and envelope evidence", () => {
		const tool = createAgentTool(probeSpec(), { run: vi.fn() } as any, BUILTIN_PROFILES);
		const theme = { fg: (_color: string, value: string) => value, bold: (value: string) => value } as any;
		const row = tool.renderCall?.({ assignment: "probe it" }, theme, { lastComponent: undefined } as any) as any;

		const running = tool.renderResult?.(
			{ content: [{ type: "text", text: "" }], details: { trace: { state: "running" }, actions: { read: 2 } } },
			{ expanded: false, isPartial: true },
			theme,
			{ args: { assignment: "probe it" }, cwd: "/repo", isError: false, lastComponent: row } as any,
		) as any;
		expect(running.render(100).map((line: string) => line.trimEnd())).toEqual(["◐ probe probe it · read ×2"]);

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
			"✓ probe probe it",
			"salvage notes",
		]);
	});
});
