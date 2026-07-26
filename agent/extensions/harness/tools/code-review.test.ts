import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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

function childTool(options: RunOptions, name: string) {
	const tool = options.toolbox?.({} as any).find((candidate) => candidate.name === name);
	expect(tool).toBeDefined();
	return tool!;
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
		const tool = createCodeReviewTool({ run } as any, BUILTIN_PROFILES, { globalRoots: [] });
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
					"run_check",
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

	it("includes discovered Check blocks and reports every Check as not-run", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-review-checks-"));
		const checksDirectory = join(root, ".agents", "checks");
		await mkdir(checksDirectory, { recursive: true });
		await writeFile(
			join(checksDirectory, "errors.md"),
			"---\nname: error-paths\ndescription: Error handling\nseverity-default: high\n---\nFind swallowed errors.\n",
		);
		const run = vi.fn(async (options: RunOptions) => {
			await submit(options, []);
			return { sessionID: "review-checks", answer: "ignored", toolLog: [] };
		});
		const result = await createCodeReviewTool({ run } as any, BUILTIN_PROFILES, { globalRoots: [] }).execute(
			"call",
			{ diff_description: "HEAD~1" },
			undefined,
			undefined,
			{ cwd: root } as any,
		);

		const message = run.mock.calls[0]?.[0].message;
		expect(message).toContain(
			"Also discover any additional applicable .agents/checks/*.md files for the changed paths and call run_check once for each applicable Check.",
		);
		expect(message).toContain('<check name="error-paths" severity-default="high"');
		expect(message).toContain("Description: Error handling\n\nFind swallowed errors.\n</check>");
		expect(textOf(result)).toContain("## Checks\n- error-paths — **not-run**");
	});

	it("briefs the check child with the severity-default and applies it to omitted severities", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-review-severity-default-"));
		const checkPath = join(root, ".agents", "checks", "strict.md");
		await mkdir(join(root, ".agents", "checks"), { recursive: true });
		await writeFile(checkPath, "---\nname: strict\nseverity-default: high\n---\nStrict instructions.");
		const run = vi.fn(async (options: RunOptions) => {
			if (options.definition.model === BUILTIN_PROFILES.agents.review.check.model) {
				expect(options.message).toContain("Default severity for submitted issues: high");
				await childTool(options, "submit_check").execute(
					"submit",
					{ issues: [{ file: "a.ts", line: 3, problem: "Raw value flows inward." }] },
					undefined,
					undefined,
					context,
				);
				return { sessionID: "check", answer: "", toolLog: [] };
			}
			await childTool(options, "run_check").execute(
				"run",
				{
					checkName: "strict",
					checkURI: pathToFileURL(checkPath).href,
					diffDescription: "HEAD",
					instructions: "Run.",
				},
				undefined,
				undefined,
				context,
			);
			await submit(options, []);
			return { sessionID: "main", answer: "", toolLog: [] };
		});
		const result = await createCodeReviewTool({ run } as any, BUILTIN_PROFILES, { globalRoots: [] }).execute(
			"call",
			{ diff_description: "HEAD" },
			undefined,
			undefined,
			{ cwd: root } as any,
		);
		expect(textOf(result)).toContain("**HIGH** line 3 — [strict] Raw value flows inward.");
		expect(textOf(result)).toContain("- strict — **ran with 1 issue**");
	});

	it("runs a discovered Check through the main toolbox and merges its submitted issues", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-review-run-check-"));
		const checksDirectory = join(root, ".agents", "checks");
		const checkPath = join(checksDirectory, "errors.md");
		await mkdir(checksDirectory, { recursive: true });
		await writeFile(checkPath, "---\nname: error-paths\nseverity-default: high\n---\nFind swallowed errors.\n");
		const run = vi.fn(async (options: RunOptions) => {
			if (options.definition.model === BUILTIN_PROFILES.agents.review.check.model) {
				expect(options.finalMessage).toBe("optional");
				await childTool(options, "submit_check").execute(
					"submit-check",
					{ issues: [{ severity: "high", file: "src/a.ts", line: 7, problem: "The rejection is swallowed." }] },
					undefined,
					undefined,
					context,
				);
				return { sessionID: "check-1", answer: "ignored", toolLog: [] };
			}
			const summary = await childTool(options, "run_check").execute(
				"run-check",
				{
					checkName: "error-paths",
					checkURI: pathToFileURL(checkPath).href,
					diffDescription: "HEAD~1",
					files: ["src/a.ts"],
					instructions: "Inspect changed error paths.",
				},
				undefined,
				undefined,
				context,
			);
			expect(textOf(summary)).toBe("error-paths ran with 1 issue.");
			await submit(options, []);
			return { sessionID: "review-checks", answer: "ignored", toolLog: [] };
		});

		const result = await createCodeReviewTool({ run } as any, BUILTIN_PROFILES, { globalRoots: [] }).execute(
			"call",
			{ diff_description: "HEAD~1" },
			undefined,
			undefined,
			{ cwd: root } as any,
		);

		expect(run).toHaveBeenCalledTimes(2);
		expect(run.mock.calls[0]?.[0].finalMessage).toBe("optional");
		expect(run.mock.calls[1]?.[0]).toMatchObject({
			definition: {
				model: BUILTIN_PROFILES.agents.review.check.model,
				tools: [
					"read",
					"grep",
					"find",
					"ls",
					"shell_command",
					"shell_command_status",
					"shell_command_cancel",
					"submit_check",
				],
			},
		});
		expect(textOf(result)).toContain("**HIGH** line 7 — [error-paths] The rejection is swallowed.");
		expect(textOf(result)).toContain("## Checks\n- error-paths — **ran with 1 issue**");
	});

	it("allows the terminating main child to omit its final message explicitly", async () => {
		const run = vi.fn(async (options: RunOptions) => {
			expect(options.finalMessage).toBe("optional");
			await submit(options, []);
			return { sessionID: "review-2", answer: "", toolLog: [] };
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

	it("retries a never-submitting Check once", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-review-retry-check-"));
		const checkPath = join(root, ".agents", "checks", "retry.md");
		await mkdir(join(root, ".agents", "checks"), { recursive: true });
		await writeFile(checkPath, "Retry instructions.");
		let attempts = 0;
		const run = vi.fn(async (options: RunOptions) => {
			if (options.definition.model === BUILTIN_PROFILES.agents.review.check.model) {
				if (++attempts === 1) return { sessionID: "empty", answer: "ignored", toolLog: [] };
				await childTool(options, "submit_check").execute("submit", { issues: [] }, undefined, undefined, context);
				return { sessionID: "retry", answer: "ignored", toolLog: [] };
			}
			await childTool(options, "run_check").execute(
				"run",
				{
					checkName: "retry",
					checkURI: pathToFileURL(checkPath).href,
					diffDescription: "HEAD",
					instructions: "Run.",
				},
				undefined,
				undefined,
				context,
			);
			await submit(options, []);
			return { sessionID: "main", answer: "ignored", toolLog: [] };
		});
		const result = await createCodeReviewTool({ run } as any, BUILTIN_PROFILES, { globalRoots: [] }).execute(
			"call",
			{ diff_description: "HEAD" },
			undefined,
			undefined,
			{ cwd: root } as any,
		);
		expect(attempts).toBe(2);
		expect(textOf(result)).toContain("- retry — **ran with 0 issues**");
	});

	it("synthesizes a valid unknown file Check and rejects garbage URIs", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-review-synth-check-"));
		const known = join(root, ".agents", "checks", "known.md");
		const extra = join(root, "packages", "pkg", ".agents", "checks", "extra.md");
		const outside = join(root, "outside.md");
		await mkdir(join(root, ".agents", "checks"), { recursive: true });
		await mkdir(join(root, "packages", "pkg", ".agents", "checks"), { recursive: true });
		await writeFile(known, "Known instructions.");
		await writeFile(extra, "---\nname: synthesized\n---\nExtra instructions.");
		await writeFile(outside, "---\nname: outside\n---\nOutside instructions.");
		const run = vi.fn(async (options: RunOptions) => {
			if (options.definition.model === BUILTIN_PROFILES.agents.review.check.model) {
				await childTool(options, "submit_check").execute("submit", { issues: [] }, undefined, undefined, context);
				return { sessionID: "check", answer: "ignored", toolLog: [] };
			}
			const tool = childTool(options, "run_check");
			await expect(
				tool.execute(
					"bad",
					{ checkName: "bad", checkURI: "garbage", diffDescription: "HEAD", instructions: "Run." },
					undefined,
					undefined,
					context,
				),
			).rejects.toThrow(`Valid Checks: known: ${pathToFileURL(known).href}`);
			await expect(
				tool.execute(
					"outside",
					{
						checkName: "outside",
						checkURI: pathToFileURL(outside).href,
						diffDescription: "HEAD",
						instructions: "Run.",
					},
					undefined,
					undefined,
					context,
				),
			).rejects.toThrow("outside every .agents/checks directory");
			await tool.execute(
				"synth",
				{
					checkName: "synthesized",
					checkURI: pathToFileURL(extra).href,
					diffDescription: "HEAD",
					instructions: "Run.",
				},
				undefined,
				undefined,
				context,
			);
			await submit(options, []);
			return { sessionID: "main", answer: "ignored", toolLog: [] };
		});
		const result = await createCodeReviewTool({ run } as any, BUILTIN_PROFILES, { globalRoots: [] }).execute(
			"call",
			{ diff_description: "HEAD" },
			undefined,
			undefined,
			{ cwd: root } as any,
		);
		expect(textOf(result)).toContain("- known — **not-run**");
		expect(textOf(result)).toContain("- synthesized — **ran with 0 issues**");
	});

	it("keeps same-name Check statuses isolated by URI and validates the supplied name", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-review-check-identity-"));
		const known = join(root, ".agents", "checks", "known.md");
		const extra = join(root, "packages", "pkg", ".agents", "checks", "extra.md");
		await mkdir(join(root, ".agents", "checks"), { recursive: true });
		await mkdir(join(root, "packages", "pkg", ".agents", "checks"), { recursive: true });
		await writeFile(known, "---\nname: duplicate\n---\nKnown instructions.");
		await writeFile(extra, "---\nname: duplicate\n---\nExtra instructions.");
		const knownURI = pathToFileURL(known).href;
		const extraURI = pathToFileURL(extra).href;
		const run = vi.fn(async (options: RunOptions) => {
			if (options.definition.model === BUILTIN_PROFILES.agents.review.check.model) {
				await childTool(options, "submit_check").execute("submit", { issues: [] }, undefined, undefined, context);
				return { sessionID: "check", answer: "", toolLog: [] };
			}
			const tool = childTool(options, "run_check");
			await expect(
				tool.execute(
					"mismatch",
					{ checkName: "wrong", checkURI: knownURI, diffDescription: "HEAD", instructions: "Run." },
					undefined,
					undefined,
					context,
				),
			).rejects.toThrow('Check name "wrong" does not match "duplicate"');
			await tool.execute(
				"extra",
				{ checkName: "duplicate", checkURI: extraURI, diffDescription: "HEAD", instructions: "Run." },
				undefined,
				undefined,
				context,
			);
			await submit(options, []);
			return { sessionID: "main", answer: "", toolLog: [] };
		});

		const result = await createCodeReviewTool({ run } as any, BUILTIN_PROFILES, { globalRoots: [] }).execute(
			"call",
			{ diff_description: "HEAD" },
			undefined,
			undefined,
			{ cwd: root } as any,
		);

		expect(textOf(result)).toContain(`- duplicate (${knownURI}) — **not-run**`);
		expect(textOf(result)).toContain(`- duplicate (${extraURI}) — **ran with 0 issues**`);
	});

	it("normalizes optional Check locations and rejects illegal ranges at the tool boundary", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-review-check-location-"));
		const checkPath = join(root, ".agents", "checks", "locations.md");
		await mkdir(join(root, ".agents", "checks"), { recursive: true });
		await writeFile(checkPath, "Location instructions.");
		const run = vi.fn(async (options: RunOptions) => {
			if (options.definition.model === BUILTIN_PROFILES.agents.review.check.model) {
				const tool = childTool(options, "submit_check");
				await expect(
					tool.execute(
						"end-only",
						{ issues: [{ severity: "high", file: "a.ts", endLine: 3, problem: "Invalid." }] },
						undefined,
						undefined,
						context,
					),
				).rejects.toThrow("endLine requires line");
				await expect(
					tool.execute(
						"reversed",
						{ issues: [{ severity: "high", file: "a.ts", line: 5, endLine: 4, problem: "Invalid." }] },
						undefined,
						undefined,
						context,
					),
				).rejects.toThrow("endLine must not be before line");
				await tool.execute(
					"valid",
					{
						issues: [
							{ severity: "high", file: "a.ts", problem: "File-wide issue." },
							{ severity: "medium", file: "a.ts", line: 7, problem: "One line." },
							{ severity: "low", file: "a.ts", line: 9, endLine: 11, problem: "A range." },
						],
					},
					undefined,
					undefined,
					context,
				);
				return { sessionID: "check", answer: "", toolLog: [] };
			}
			await childTool(options, "run_check").execute(
				"run",
				{
					checkName: "locations",
					checkURI: pathToFileURL(checkPath).href,
					diffDescription: "HEAD",
					instructions: "Run.",
				},
				undefined,
				undefined,
				context,
			);
			await submit(options, []);
			return { sessionID: "main", answer: "", toolLog: [] };
		});

		const result = await createCodeReviewTool({ run } as any, BUILTIN_PROFILES, { globalRoots: [] }).execute(
			"call",
			{ diff_description: "HEAD" },
			undefined,
			undefined,
			{ cwd: root } as any,
		);

		expect(textOf(result)).toContain("**HIGH** — [locations] File-wide issue.");
		expect(textOf(result)).toContain("**MEDIUM** line 7 — [locations] One line.");
		expect(textOf(result)).toContain("**LOW** lines 9-11 — [locations] A range.");
		expect(textOf(result)).not.toContain("line 1 — [locations]");
	});

	it("retries provider errors and does not accept a submission from a failed attempt", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-review-check-error-"));
		const checkPath = join(root, ".agents", "checks", "provider.md");
		await mkdir(join(root, ".agents", "checks"), { recursive: true });
		await writeFile(checkPath, "Provider instructions.");
		let attempts = 0;
		const run = vi.fn(async (options: RunOptions) => {
			if (options.definition.model === BUILTIN_PROFILES.agents.review.check.model) {
				attempts++;
				await childTool(options, "submit_check").execute(
					"submit",
					{ issues: [{ severity: "high", file: "a.ts", problem: "Must not survive." }] },
					undefined,
					undefined,
					context,
				);
				throw new SubagentRunError(`check-${attempts}`, [], new Error("provider failed"));
			}
			const summary = await childTool(options, "run_check").execute(
				"run",
				{
					checkName: "provider",
					checkURI: pathToFileURL(checkPath).href,
					diffDescription: "HEAD",
					instructions: "Run.",
				},
				undefined,
				undefined,
				context,
			);
			expect(textOf(summary)).toBe("provider error.");
			await submit(options, []);
			return { sessionID: "main", answer: "", toolLog: [] };
		});

		const result = await createCodeReviewTool({ run } as any, BUILTIN_PROFILES, { globalRoots: [] }).execute(
			"call",
			{ diff_description: "HEAD" },
			undefined,
			undefined,
			{ cwd: root } as any,
		);

		expect(attempts).toBe(2);
		expect(textOf(result)).toContain("- provider — **error**");
		expect(textOf(result)).not.toContain("Must not survive.");
	});

	it("propagates abort to an in-flight Check child", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-review-check-abort-"));
		const checkPath = join(root, ".agents", "checks", "abort.md");
		await mkdir(join(root, ".agents", "checks"), { recursive: true });
		await writeFile(checkPath, "Abort instructions.");
		const controller = new AbortController();
		let markStarted!: () => void;
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		const run = vi.fn(async (options: RunOptions) => {
			if (options.definition.model === BUILTIN_PROFILES.agents.review.check.model) {
				expect(options.signal).toBe(controller.signal);
				markStarted();
				return new Promise<never>((_resolve, reject) => {
					options.signal?.addEventListener("abort", () => reject(new SubagentAbortError("check-abort")), {
						once: true,
					});
				});
			}
			await childTool(options, "run_check").execute(
				"run",
				{
					checkName: "abort",
					checkURI: pathToFileURL(checkPath).href,
					diffDescription: "HEAD",
					instructions: "Run.",
				},
				undefined,
				undefined,
				context,
			);
			throw new Error("unreachable");
		});
		const running = createCodeReviewTool({ run } as any, BUILTIN_PROFILES, { globalRoots: [] }).execute(
			"call",
			{ diff_description: "HEAD" },
			controller.signal,
			undefined,
			{ cwd: root } as any,
		);

		await started;
		controller.abort();
		const result = await running;
		expect(textOf(result)).toContain('<review_error sessionID="check-abort">');
		expect(textOf(result)).toContain("- abort — **not-run**");
		expect(result.details).toMatchObject({ trace: { state: "cancelled" } });
	});

	it("propagates abort and passes the signal to the child", async () => {
		const controller = new AbortController();
		const run = vi.fn(async (options: RunOptions) => {
			expect(options.signal).toBe(controller.signal);
			throw new SubagentAbortError("review-3");
		});
		const result = await createCodeReviewTool({ run } as any, BUILTIN_PROFILES).execute(
			"call",
			{ diff_description: "HEAD" },
			controller.signal,
			undefined,
			context,
		);
		expect(textOf(result)).toContain('<review_error sessionID="review-3">');
		expect(result.details).toMatchObject({ trace: { state: "cancelled" } });
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

	it("rethrows when the child fails before creating a session", async () => {
		const run = vi.fn(async () => {
			throw new Error("model unavailable");
		});
		await expect(
			createCodeReviewTool({ run } as any, BUILTIN_PROFILES).execute(
				"call",
				{ diff_description: "HEAD" },
				undefined,
				undefined,
				context,
			),
		).rejects.toThrow("model unavailable");
	});

	it("renders review progress with tool tallies", () => {
		const tool = createCodeReviewTool({ run: vi.fn() } as any, BUILTIN_PROFILES);
		const theme = { fg: (_color: string, value: string) => value, bold: (value: string) => value } as any;
		const row = tool.renderCall?.({ diff_description: "HEAD~1" }, theme, { lastComponent: undefined } as any) as any;
		tool.renderResult?.(
			{
				content: [{ type: "text", text: "" }],
				details: { trace: { state: "running" }, toolCallCounts: { read: 2 } },
			},
			{ expanded: false, isPartial: true },
			theme,
			{ args: { diff_description: "HEAD~1" }, cwd: "/repo", isError: false, lastComponent: row } as any,
		);
		expect(row.render(100).map((line: string) => line.trimEnd())).toEqual([" ◐ review HEAD~1 · read ×2"]);
	});
});
