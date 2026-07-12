import { describe, expect, it, vi } from "vitest";
import { Text } from "@earendil-works/pi-tui";
import { BUILTIN_PROFILES } from "../profiles.ts";
import type { RunOptions } from "../runner.ts";
import { createFinderTool, extractFinderAnswer, finderEnvelopeTitle } from "./finder.ts";

describe("finder tool", () => {
	it("lifts the first title line into the result envelope", async () => {
		const run = vi.fn(async (options: RunOptions<{ query: string }>) =>
			options.wrapResult("finder-session", "Authentication entry points\n/abs/auth.ts:12 — login route"));
		const tool = createFinderTool({ run } as any, BUILTIN_PROFILES);
		const result = await tool.execute("call", { query: "find auth" }, undefined, undefined, { cwd: "/repo" } as any);
		expect(result.content[0]).toEqual({
			type: "text",
			text: '<finder_result title="Authentication entry points" sessionID="finder-session">\n/abs/auth.ts:12 — login route\n</finder_result>',
		});
		const options = run.mock.calls[0]?.[0];
		expect(options?.definition).toMatchObject({
			key: "finder", model: "anthropic/claude-haiku-4-5", reasoningEffort: "minimal",
			tools: ["read", "grep", "find", "ls"], allowMcp: false,
		});
		expect(options?.mapInput({ query: "find auth" })).toBe("find auth");
	});

	it("turns an empty final answer into a normal nothing-matched envelope", () => {
		expect(extractFinderAnswer("  ")).toEqual({ title: "Nothing matched", content: "Nothing matched." });
	});

	it("extracts and decodes the completion title for the TUI", () => {
		expect(finderEnvelopeTitle('<finder_result title="Auth &amp; sessions" sessionID="one">\nx\n</finder_result>'))
			.toBe("Auth & sessions");
	});

	it("replaces the running row with the completion title", () => {
		const tool = createFinderTool({ run: vi.fn() } as any, BUILTIN_PROFILES);
		const theme = { fg: (_color: string, value: string) => value, bold: (value: string) => value } as any;
		const row = tool.renderCall?.({ query: "find auth" }, theme, { lastComponent: undefined } as any) as Text;
		const completed = tool.renderResult?.(
			{ content: [{ type: "text", text: '<finder_result title="Auth files" sessionID="one">\nx\n</finder_result>' }], details: {} },
			{ expanded: false, isPartial: false }, theme, { lastComponent: row } as any,
		);
		expect(completed).toBe(row);
		expect(row.render(100).map((line) => line.trimEnd())).toEqual(["✓ Auth files"]);
	});
});
