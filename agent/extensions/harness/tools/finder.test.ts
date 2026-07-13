import type { Text } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { BUILTIN_PROFILES } from "../profiles.ts";
import { type RunOptions, SubagentAbortError } from "../runner.ts";
import { createFinderTool, extractFinderAnswer, finderEnvelopeTitle } from "./finder.ts";

describe("finder tool", () => {
	it("lifts the first title line into the result envelope", async () => {
		const run = vi.fn(async (options: RunOptions<{ query: string }>) =>
			options.wrapResult("finder-session", "Authentication entry points\n/abs/auth.ts:12 — login route"),
		);
		const tool = createFinderTool({ run } as any, BUILTIN_PROFILES);
		const updates: any[] = [];
		const result = await tool.execute(
			"call",
			{ query: "find auth" },
			undefined,
			(update: any) => updates.push(update),
			{
				cwd: "/repo",
			} as any,
		);
		expect(updates[0]?.details).toEqual({ trace: { state: "running" }, actions: {} });
		expect(result.details).toMatchObject({ trace: { state: "success" } });
		expect(result.content[0]).toEqual({
			type: "text",
			text: '<finder_result title="Authentication entry points" sessionID="finder-session">\n/abs/auth.ts:12 — login route\n</finder_result>',
		});
		const options = run.mock.calls[0]?.[0];
		expect(options?.definition).toMatchObject({
			key: "finder",
			model: "anthropic/claude-haiku-4-5",
			reasoningEffort: "minimal",
			tools: ["read", "grep", "find", "ls"],
			allowMcp: false,
		});
		expect(options?.mapInput({ query: "find auth" })).toBe("find auth");
	});

	it("turns an empty final answer into a normal nothing-matched envelope", () => {
		expect(extractFinderAnswer("  ")).toEqual({ title: "Nothing matched", content: "Nothing matched." });
	});

	it("extracts and decodes the completion title for the TUI", () => {
		expect(
			finderEnvelopeTitle('<finder_result title="Auth &amp; sessions" sessionID="one">\nx\n</finder_result>'),
		).toBe("Auth & sessions");
	});

	it("propagates the runner's typed cancellation outcome", async () => {
		const tool = createFinderTool(
			{ run: vi.fn().mockRejectedValue(new SubagentAbortError("finder-1")) } as any,
			BUILTIN_PROFILES,
		);

		await expect(
			tool.execute("call-1", { query: "find auth" }, undefined, undefined, { cwd: "/repo" } as any),
		).rejects.toBeInstanceOf(SubagentAbortError);
	});

	it("retains the original query after completion", () => {
		const tool = createFinderTool({ run: vi.fn() } as any, BUILTIN_PROFILES);
		const theme = { fg: (_color: string, value: string) => value, bold: (value: string) => value } as any;
		const row = tool.renderCall?.({ query: "find auth" }, theme, { lastComponent: undefined } as any) as Text;
		const completed = tool.renderResult?.(
			{
				content: [
					{ type: "text", text: '<finder_result title="Auth files" sessionID="one">\nx\n</finder_result>' },
				],
				details: { trace: { state: "success" } },
			},
			{ expanded: false, isPartial: false },
			theme,
			{ args: { query: "find auth" }, cwd: "/repo", isError: false, lastComponent: row } as any,
		);
		expect(completed).toBe(row);
		expect(row.render(100).map((line) => line.trimEnd())).toEqual(["✓ finder find auth"]);
	});
});
