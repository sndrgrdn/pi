import { describe, expect, it, vi } from "vitest";
import { BUILTIN_PROFILES } from "../profiles.ts";
import { type RunOptions, SubagentAbortError, SubagentRunError } from "../runner.ts";
import { createCodeReviewTool } from "./code-review.ts";

const context = { cwd: "/repo" } as any;
const textOf = (result: any): string => result.content[0].text;

async function submit(options: RunOptions, comments: unknown[]) {
	const tool = options.toolbox?.({} as any).find((candidate) => candidate.name === "submit_review");
	expect(tool).toBeDefined();
	await tool?.execute("submit", { comments }, undefined, undefined, context);
}

describe("code_review tool", () => {
	it("returns a deterministic main review with no Checks", async () => {
		const run = vi.fn(async (options: RunOptions) => {
			options.onToolCall?.({ tool: "read", summary: "read a.ts" });
			await submit(options, [
				{ filename: "z.ts", startLine: 8, endLine: 8, severity: "low", text: "Rename this." },
				{
					filename: "a.ts",
					startLine: 4,
					endLine: 6,
					severity: "high",
					text: "Handle the rejected promise.",
					why: "The request can fail.",
					fix: "Await and return the error.",
				},
			]);
			return { sessionID: "review-1", answer: "ignored", toolLog: [] };
		});
		const tool = createCodeReviewTool({ run } as any, BUILTIN_PROFILES);
		const result = await tool.execute(
			"call",
			{
				diff_description: "uncommitted changes",
				files: ["a.ts"],
				instructions: "Focus on errors",
				thinking: "high",
			},
			undefined,
			undefined,
			{ ...context, sessionManager: { getSessionFile: () => "/sessions/parent.jsonl" } },
		);

		expect(run.mock.calls[0]?.[0]).toMatchObject({
			definition: {
				key: "review",
				model: "openai-codex/gpt-5.6-sol",
				reasoningEffort: "high",
				tools: [
					"read",
					"grep",
					"find",
					"ls",
					"shell_command",
					"shell_command_status",
					"shell_command_cancel",
					"submit_review",
				],
			},
			message: expect.stringContaining("Diff description: uncommitted changes"),
			record: { parentSession: "/sessions/parent.jsonl", name: "review: uncommitted changes" },
		});
		expect(textOf(result)).toBe(`<review_result sessionID="review-1">
## Comments

### a.ts
- **HIGH** lines 4-6 — Handle the rejected promise.
  - Why: The request can fail.
  - Fix: Await and return the error.

### z.ts
- **LOW** line 8 — Rename this.

## Checks
No checks were run.
</review_result>`);
		expect(result.details).toMatchObject({
			trace: { state: "success" },
			toolCallCounts: { read: 1 },
			toolCalls: ["read a.ts"],
		});
	});

	it("accepts submit_review followed by the runner's no-final-message failure", async () => {
		const run = vi.fn(async (options: RunOptions) => {
			await submit(options, []);
			throw new SubagentRunError("review-2", [], new Error("review child returned no final message"));
		});
		const result = await createCodeReviewTool({ run } as any, BUILTIN_PROFILES).execute(
			"call",
			{ diff_description: "HEAD~1" },
			undefined,
			undefined,
			context,
		);
		expect(textOf(result)).toContain('<review_result sessionID="review-2">');
		expect(textOf(result)).toContain("No comments.");
	});

	it("propagates abort and passes the signal to the child", async () => {
		const controller = new AbortController();
		const run = vi.fn(async (options: RunOptions) => {
			expect(options.signal).toBe(controller.signal);
			throw new SubagentAbortError("review-3");
		});
		await expect(
			createCodeReviewTool({ run } as any, BUILTIN_PROFILES).execute(
				"call",
				{ diff_description: "HEAD" },
				controller.signal,
				undefined,
				context,
			),
		).rejects.toBeInstanceOf(SubagentAbortError);
	});

	it("returns review_error with a submission captured before failure", async () => {
		const run = vi.fn(async (options: RunOptions) => {
			await submit(options, [{ filename: "a.ts", startLine: 2, endLine: 2, severity: "medium", text: "Captured." }]);
			throw new SubagentRunError("review-4", [], new Error("provider failed"));
		});
		const result = await createCodeReviewTool({ run } as any, BUILTIN_PROFILES).execute(
			"call",
			{ diff_description: "HEAD" },
			undefined,
			undefined,
			context,
		);
		expect(textOf(result)).toContain('<review_error sessionID="review-4">');
		expect(textOf(result)).toContain("Review failed: provider failed");
		expect(textOf(result)).toContain("**MEDIUM** line 2 — Captured.");
		expect(result.details).toMatchObject({ trace: { state: "failed" } });
	});
});
