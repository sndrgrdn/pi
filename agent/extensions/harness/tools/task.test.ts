import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Text } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { BUILTIN_PROFILES } from "../profiles.ts";
import { type RunOptions, SubagentAbortError, SubagentRunError } from "../runner.ts";
import { BackgroundShellRegistry } from "../shell/registry.ts";
import { createTaskTool } from "./task.ts";

describe("task tool", () => {
	it("uses the stable system prompt verbatim in the Task child prompt", async () => {
		const system = readFileSync(join(import.meta.dirname, "../../../SYSTEM.md"), "utf8");
		const run = vi.fn(async (options: RunOptions) => {
			expect(options.definition.systemPrompt).toBe(`${system}\n\nA\n\nC`);
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
		["high", "openai-codex/gpt-5.6-sol", "high"],
	] as const)(
		"routes effort %s independently and exposes the exact Task toolbox",
		async (effort, model, reasoning) => {
			const run = vi.fn(async (options: RunOptions) => {
				options.onAction?.("apply_patch");
				return { sessionID: "task-1", answer: "Changed x.ts. Verification: tests pass.", toolLog: [] };
			});
			const tool = createTaskTool({ run } as any, BUILTIN_PROFILES, {
				basePrompts: () => ({ system: "S", appendSystem: "A", projectContext: "C" }),
			});
			const params = { prompt: "Implement it", description: "implementation", ...(effort ? { effort } : {}) };
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
					"finder",
					"librarian",
				],
			});
			expect(options.definition.systemPrompt).toBe("S\n\nA\n\nC");
			expect(options.message).toBe("Implement it");
			expect(options.toolbox!(new BackgroundShellRegistry()).map((entry) => entry.name)).toEqual([
				"shell_command",
				"shell_command_status",
				"shell_command_cancel",
				"read",
				"apply_patch",
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
				effort: effort ?? "standard",
				description: "implementation",
			});
			expect(result.details).toMatchObject({
				trace: { state: "success" },
				effort: effort ?? "standard",
				description: "implementation",
			});
		},
	);

	it.each([undefined, "high"] as const)("always renders selected effort %s", (effort) => {
		const tool = createTaskTool({ run: vi.fn() } as any, BUILTIN_PROFILES);
		const theme = { fg: (_color: string, value: string) => value, bold: (value: string) => value } as any;
		const args = { prompt: "Work", description: "fix renderer", ...(effort ? { effort } : {}) };
		const row = tool.renderResult?.(
			{ content: [{ type: "text", text: '<task_result sessionID="one">\nDone\n</task_result>' }], details: {} },
			{ expanded: false, isPartial: false },
			theme,
			{ args, cwd: "/repo", isError: false } as any,
		) as Text;
		expect(row.render(100).map((line) => line.trimEnd())).toEqual([` ✓ task (${effort ?? "standard"}) fix renderer`]);
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
		expect(result.details).toMatchObject({ trace: { state: "cancelled" }, effort: "standard", description: "work" });
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
		expect(run.mock.calls[0]![0].record).toEqual({
			parentSession: "/sessions/parent.jsonl",
			name: "task: work",
		});
		expect(run.mock.calls[1]![0].signal).toBe(controller.signal);
		expect(run.mock.calls[1]![0]).not.toHaveProperty("record");
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
