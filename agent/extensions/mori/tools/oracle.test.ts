import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Text } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { BUILTIN_PROFILES } from "../profiles.ts";
import { type RunOptions, SubagentRunError } from "../runner.ts";
import { BackgroundShellRegistry } from "../shell/registry.ts";
import { createOracleTool } from "./oracle.ts";

interface OracleParams {
	task: string;
	context?: string;
	files?: string[];
}

/** Run the tool against a fake runner and capture the child message it plans. */
async function capturedMessage(params: OracleParams, cwd: string): Promise<string> {
	const run = vi.fn(async (_options: RunOptions) => ({ sessionID: "oracle-1", answer: "Advice", toolLog: [] }));
	const tool = createOracleTool({ run } as any, BUILTIN_PROFILES);
	await tool.execute("call", params, undefined, undefined, { cwd } as any);
	return run.mock.calls[0]?.[0].message as string;
}

describe("oracle tool", () => {
	it("embeds readable files and silently skips unreadable files", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "oracle-"));
		writeFileSync(join(cwd, "route.ts"), "export const route = 'high';\n");

		const message = await capturedMessage(
			{
				task: "Review routing",
				context: "Focus on profile selection.",
				files: ["route.ts", "missing.ts"],
			},
			cwd,
		);

		expect(message).toContain("Task: Review routing");
		expect(message).toContain("Context: Focus on profile selection.");
		expect(message).toContain("File: route.ts\n```ts\nexport const route = 'high';\n```");
		expect(message).not.toContain("missing.ts");
	});

	it("uses a fence longer than backtick runs in embedded content", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "oracle-"));
		writeFileSync(join(cwd, "example.md"), "```ts\nunsafe()\n```\n");

		const message = await capturedMessage({ task: "Review", files: ["example.md"] }, cwd);

		expect(message).toContain("File: example.md\n````md\n```ts\nunsafe()\n```\n````");
	});

	it("embeds files containing many separate backtick runs", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "oracle-"));
		writeFileSync(join(cwd, "many.txt"), "` x ".repeat(150_000));

		const message = await capturedMessage({ task: "Review", files: ["many.txt"] }, cwd);

		expect(message).toContain("File: many.txt\n```txt\n");
	});

	it("uses its configured expert route", async () => {
		const run = vi.fn(async (_options: RunOptions) => ({
			sessionID: "oracle-1",
			answer: "Use the smaller change.",
			toolLog: [],
		}));
		const tool = createOracleTool({ run } as any, BUILTIN_PROFILES);
		const result = await tool.execute("call", { task: "Review it" }, undefined, undefined, { cwd: "/repo" } as any);

		expect(run.mock.calls[0]?.[0].definition).toMatchObject({
			key: "oracle",
			model: "openai-codex/gpt-5.6-sol",
			reasoningEffort: "high",
			allowMcp: false,
			tools: ["shell_command", "shell_command_status", "shell_command_cancel", "finder", "librarian"],
		});
		const toolbox = run.mock.calls[0]?.[0].toolbox;
		expect(toolbox).toEqual(expect.any(Function));
		expect(toolbox?.(new BackgroundShellRegistry()).map((tool: { name: string }) => tool.name)).toEqual([
			"shell_command",
			"shell_command_status",
			"shell_command_cancel",
			"finder",
			"librarian",
		]);
		expect(result.content[0]).toEqual({
			type: "text",
			text: '<oracle_result sessionID="oracle-1">\nUse the smaller change.\n</oracle_result>',
		});
	});

	it("reports progress without any parent mode state", async () => {
		const run = vi.fn(async (options: RunOptions) => {
			options.onToolCall?.({ tool: "finder", summary: "finder inspect locking" });
			return { sessionID: "oracle-1", answer: "Advice", toolLog: [] };
		});
		const tool = createOracleTool({ run } as any, BUILTIN_PROFILES);
		const updates: any[] = [];
		const result = await tool.execute(
			"call",
			{ task: "Review it" },
			undefined,
			(update: any) => updates.push(update),
			{
				cwd: "/repo",
			} as any,
		);
		expect(run.mock.calls[0]?.[0].definition.model).toBe("openai-codex/gpt-5.6-sol");
		expect(updates.at(-1)?.details).toEqual({
			trace: { state: "running" },
			toolCallCounts: { finder: 1 },
			toolCalls: ["finder inspect locking"],
		});
		expect(result.details).toEqual({
			trace: { state: "success" },
			toolCallCounts: { finder: 1 },
			toolCalls: ["finder inspect locking"],
		});
	});

	it("rejects an empty final message with the child session attributed", async () => {
		const run = vi.fn(async (_options: RunOptions) => ({ sessionID: "oracle-1", answer: "  ", toolLog: [] }));
		const tool = createOracleTool({ run } as any, BUILTIN_PROFILES);
		const failure = await tool
			.execute("call", { task: "Review it" }, undefined, undefined, { cwd: "/repo" } as any)
			.then(
				() => undefined,
				(error: unknown) => error,
			);
		expect(failure).toBeInstanceOf(SubagentRunError);
		expect(failure).toMatchObject({ sessionID: "oracle-1", message: "Oracle child returned an empty final message" });
	});

	it("retains the original task after completion", () => {
		const tool = createOracleTool({ run: vi.fn() } as any, BUILTIN_PROFILES);
		const theme = { fg: (_color: string, value: string) => value, bold: (value: string) => value } as any;
		const row = tool.renderCall?.({ task: "Review routing" }, theme, { lastComponent: undefined } as any) as Text;
		tool.renderResult?.(
			{
				content: [{ type: "text", text: '<oracle_result sessionID="one">\nAdvice\n</oracle_result>' }],
				details: { trace: { state: "success" } },
			},
			{ expanded: false, isPartial: false },
			theme,
			{ args: { task: "Review routing" }, cwd: "/repo", isError: false, lastComponent: row } as any,
		);
		expect(row.render(100).map((line) => line.trimEnd())).toEqual([" ✓ oracle Review routing"]);
	});
});
