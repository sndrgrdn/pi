import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Text } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { BUILTIN_PROFILES, POSTURES, TASK_POSTURE } from "../profiles.ts";
import { type RunOptions, SubagentAbortError, SubagentRunError } from "../runner.ts";
import { BackgroundShellRegistry } from "../shell/registry.ts";
import { createTaskTool } from "./task.ts";

describe("task tool", () => {
	it("keeps the restraint-first delegation contract in the Task child prompt", async () => {
		const system = readFileSync(join(import.meta.dirname, "../../../SYSTEM.md"), "utf8");
		const delegation = `## Delegation

- default: do it yourself. delegate only when it beats direct work:
  parallel independent items, a large noisy search worth isolating,
  or a bounded sub-task worth its own context
- never delegate single-response work: one lookup, one read, a
  question you can answer directly
- fan out in one message for independent items; serialize dependent ones
- the child sees none of this conversation: the brief must be complete —
  context, paths, constraints, verification steps
- summarize results for the user; they cannot see subagent output
- trust subagent results; do not re-check them just to verify`;
		const run = vi.fn(async (options: RunOptions) => {
			expect(options.definition.systemPrompt).toContain(delegation);
			return { sessionID: "task-1", answer: "Done", toolLog: [] };
		});
		const tool = createTaskTool({ run } as any, BUILTIN_PROFILES, {
			basePrompts: () => ({ system, appendSystem: "A", projectContext: "C" }),
		});

		await tool.execute("call", { prompt: "Implement it", description: "implementation" }, undefined, undefined, {
			cwd: "/repo",
		} as any);
	});

	it.each([
		[undefined, "openai-codex/gpt-5.6-sol", "low"],
		["low", "openai-codex/gpt-5.6-sol", "low"],
		["medium", "openai-codex/gpt-5.6-sol", "high"],
		["high", "anthropic/claude-fable-5", "high"],
	] as const)("routes mode %s independently and exposes the exact Task toolbox", async (mode, model, reasoning) => {
		const run = vi.fn(async (options: RunOptions) => {
			options.onAction?.("apply_patch");
			return { sessionID: "task-1", answer: "Changed x.ts. Verification: tests pass.", toolLog: [] };
		});
		const tool = createTaskTool({ run } as any, BUILTIN_PROFILES, {
			basePrompts: () => ({ system: "S", appendSystem: "A", projectContext: "C" }),
		});
		const params = { prompt: "Implement it", description: "implementation", ...(mode ? { mode } : {}) };
		const updates: any[] = [];
		const result = await tool.execute("call", params, undefined, (update: any) => updates.push(update), {
			cwd: "/repo",
		} as any);
		const options = run.mock.calls[0]![0];

		expect(options.definition).toMatchObject({
			key: "task",
			model,
			reasoningEffort: reasoning,
			allowMcp: true,
			tools: [
				"shell_command",
				"shell_command_status",
				"shell_command_cancel",
				"read",
				"apply_patch",
				"skill",
				"finder",
				"librarian",
			],
		});
		expect(options.definition.systemPrompt).toBe(`S\n\nA\n\nC\n\n${POSTURES[mode ?? "low"]}\n\n${TASK_POSTURE}`);
		expect(options.message).toBe("Implement it");
		expect(options.toolbox!(new BackgroundShellRegistry()).map((entry) => entry.name)).toEqual([
			"shell_command",
			"shell_command_status",
			"shell_command_cancel",
			"read",
			"apply_patch",
			"skill",
			"finder",
			"librarian",
		]);
		expect(result.content[0]).toEqual({
			type: "text",
			text: '<task_result sessionID="task-1">\nChanged x.ts. Verification: tests pass.\n</task_result>',
		});
		expect(updates.at(-1)?.details).toMatchObject({
			trace: { state: "running" },
			actions: { apply_patch: 1 },
			mode: mode ?? "low",
			description: "implementation",
		});
		expect(result.details).toMatchObject({
			trace: { state: "success" },
			mode: mode ?? "low",
			description: "implementation",
		});
	});

	it.each([undefined, "low", "medium", "high"] as const)("always renders selected Mode %s", (mode) => {
		const tool = createTaskTool({ run: vi.fn() } as any, BUILTIN_PROFILES);
		const theme = { fg: (_color: string, value: string) => value, bold: (value: string) => value } as any;
		const args = { prompt: "Work", description: "fix renderer", ...(mode ? { mode } : {}) };
		const row = tool.renderResult?.(
			{ content: [{ type: "text", text: '<task_result sessionID="one">\nDone\n</task_result>' }], details: {} },
			{ expanded: false, isPartial: false },
			theme,
			{ args, cwd: "/repo", isError: false } as any,
		) as Text;
		expect(row.render(100).map((line) => line.trimEnd())).toEqual([` ✓ task (${mode ?? "low"}) fix renderer`]);
	});

	it("reports capped completed and in-progress work when cancellation interrupts a tool log", async () => {
		const abort = new SubagentAbortError("task-cancelled", [
			{
				id: "1",
				tool: "apply_patch",
				input: { patch: Array.from({ length: 25 }, (_, i) => `+line ${i}`).join("\n") },
				output: "Success",
			},
			{
				id: "2",
				tool: "shell_command",
				input: { command: "x".repeat(100) },
				output: Array.from({ length: 14 }, (_, i) => `output ${i}`).join("\n"),
			},
			{ id: "3", tool: "read", input: { path: "still-reading.png" } },
		]);
		const tool = createTaskTool({ run: vi.fn().mockRejectedValue(abort) } as any, BUILTIN_PROFILES, {
			basePrompts: () => ({ system: "S", appendSystem: "A", projectContext: "C" }),
		});
		const result = await tool.execute("call", { prompt: "Work", description: "work" }, undefined, undefined, {
			cwd: "/repo",
		} as any);
		const report = (result.content[0] as { text: string }).text;

		expect(report).toContain('<task_error sessionID="task-cancelled">');
		expect(report).toContain("Task was cancelled.\n\n## Completed work");
		expect(report).toContain("+line 19");
		expect(report).not.toContain("+line 20");
		expect(report).toContain("output 9");
		expect(report).not.toContain("output 10");
		expect(report).toContain(`Command: ${"x".repeat(80)}…`);
		expect(report).toContain("## In progress when cancelled\n\n- read: still-reading.png");
		expect(result.details).toMatchObject({ trace: { state: "cancelled" }, mode: "low", description: "work" });
	});

	it("returns cancellation failures in a task_error envelope", async () => {
		const error = new SubagentAbortError("task-cancelled", [
			{ id: "1", tool: "shell_command", input: { command: "npm test" }, output: "2 tests passed" },
		]);
		const tool = createTaskTool({ run: vi.fn().mockRejectedValue(error) } as any, BUILTIN_PROFILES, {
			basePrompts: () => ({ system: "S", appendSystem: "A", projectContext: "C" }),
		});
		const result = await tool.execute("call", { prompt: "Work", description: "work" }, undefined, undefined, {
			cwd: "/repo",
		} as any);

		expect(result.content[0]).toMatchObject({
			type: "text",
			text: expect.stringContaining('<task_error sessionID="task-cancelled">\nTask was cancelled.'),
		});
		expect(result.details).toMatchObject({ trace: { state: "cancelled" } });
	});

	it("propagates a pre-child typed cancellation for the Trace registrar", async () => {
		const abort = new SubagentAbortError();
		const tool = createTaskTool({ run: vi.fn().mockRejectedValue(abort) } as any, BUILTIN_PROFILES, {
			basePrompts: () => ({ system: "S", appendSystem: "A", projectContext: "C" }),
		});

		await expect(
			tool.execute("call-1", { prompt: "Work", description: "work" }, undefined, undefined, { cwd: "/repo" } as any),
		).rejects.toBe(abort);
	});

	it("summarizes a child hard error into a task_error payload", async () => {
		const failure = new SubagentRunError(
			"task-failed",
			[{ id: "1", tool: "apply_patch", input: { patch: "+change" }, output: "Success" }],
			new Error("context window exceeded"),
		);
		const controller = new AbortController();
		const run = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce({
			sessionID: "summary-1",
			answer: "Changed app.ts; verification did not run.",
			toolLog: [],
		});
		const tool = createTaskTool({ run } as any, BUILTIN_PROFILES, {
			basePrompts: () => ({ system: "S", appendSystem: "A", projectContext: "C" }),
		});
		const result = await tool.execute("call", { prompt: "Work", description: "work" }, controller.signal, undefined, {
			cwd: "/repo",
			sessionManager: { getSessionFile: () => "/sessions/parent.jsonl" },
		} as any);

		expect(run).toHaveBeenCalledTimes(2);
		expect(run.mock.calls[0]![0]).toMatchObject({
			parentSession: "/sessions/parent.jsonl",
			recordName: "task: work",
		});
		expect(run.mock.calls[1]![0].signal).toBe(controller.signal);
		expect(run.mock.calls[1]![0]).not.toHaveProperty("parentSession");
		expect(run.mock.calls[1]![0]).not.toHaveProperty("recordName");
		expect(result.content[0]).toEqual({
			type: "text",
			text: '<task_error sessionID="task-failed">\nChanged app.ts; verification did not run.\n</task_error>',
		});
		expect(result.details).toMatchObject({ trace: { state: "failed" } });
	});

	it("returns the original mechanical report when summarization is cancelled", async () => {
		const failure = new SubagentRunError(
			"task-failed",
			[{ id: "1", tool: "apply_patch", input: { patch: "+change" }, output: "Success" }],
			new Error("provider failed"),
		);
		const summaryAbort = new SubagentAbortError("summary-failed");
		const run = vi.fn().mockRejectedValueOnce(failure).mockRejectedValueOnce(summaryAbort);
		const tool = createTaskTool({ run } as any, BUILTIN_PROFILES, {
			basePrompts: () => ({ system: "S", appendSystem: "A", projectContext: "C" }),
		});

		const result = await tool.execute("call", { prompt: "Work", description: "work" }, undefined, undefined, {
			cwd: "/repo",
		} as any);

		expect(result.content[0]).toMatchObject({
			type: "text",
			text: expect.stringContaining('<task_error sessionID="task-failed">\nTask was cancelled.'),
		});
	});

	it("injects skill-trigger directives from the Task brief", async () => {
		const run = vi.fn(async (options: RunOptions) => {
			expect(options.message).toMatch(
				/^<skill_directive>[\s\S]*<skill>tdd<\/skill>[\s\S]*<\/skill_directive>\n\nUse \$tdd/,
			);
			return { sessionID: "task-skill", answer: "Done", toolLog: [] };
		});
		const tool = createTaskTool({ run } as any, BUILTIN_PROFILES, {
			basePrompts: () => ({ system: "S", appendSystem: "A", projectContext: "C" }),
		});
		await tool.execute("call", { prompt: "Use $tdd", description: "skill" }, undefined, undefined, {
			cwd: "/repo",
		} as any);
	});

	it("provides image attachments through read inside the Task toolbox", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "task-image-"));
		copyFileSync(
			join(
				process.cwd(),
				"node_modules/.pnpm/highlight.js@10.7.3/node_modules/highlight.js/styles/brown-papersq.png",
			),
			join(cwd, "pixel.png"),
		);
		const run = vi.fn(async (options: RunOptions) => {
			const read = options.toolbox!(new BackgroundShellRegistry()).find((entry) => entry.name === "read")!;
			const result = await read.execute("read", { path: "pixel.png" }, undefined, undefined, { cwd } as any);
			expect(result.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "image" })]));
			return { sessionID: "task-image", answer: "Image inspected", toolLog: [] };
		});
		const tool = createTaskTool({ run } as any, BUILTIN_PROFILES, {
			basePrompts: () => ({ system: "S", appendSystem: "A", projectContext: "C" }),
		});
		await tool.execute("call", { prompt: "Inspect image", description: "image" }, undefined, undefined, {
			cwd,
		} as any);
	});
});
