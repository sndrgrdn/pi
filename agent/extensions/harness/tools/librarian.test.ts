import { describe, expect, it, vi } from "vitest";
import { BUILTIN_PROFILES } from "../profiles.ts";
import type { RunOptions } from "../runner.ts";
import { BackgroundShellRegistry } from "../shell/registry.ts";
import { createLibrarianTool, librarianMessage, mapLibrarianError } from "./librarian.ts";

describe("librarian tool", () => {
	it("prepends optional context and returns the final answer envelope", async () => {
		const run = vi.fn(async (options: RunOptions<{ query: string; context?: string }>) =>
			options.wrapResult("library-1", "Use [the source](https://example.com)."),
		);
		const tool = createLibrarianTool({ run } as any, BUILTIN_PROFILES);
		const result = await tool.execute("call", { query: "How?", context: "Ruby 3.4" }, undefined, undefined, {
			cwd: "/repo",
		} as any);
		expect(result.content[0]).toMatchObject({
			type: "text",
			text: expect.stringContaining('<librarian_result sessionID="library-1">'),
		});
		const options = run.mock.calls[0]?.[0];
		expect(options?.mapInput({ query: "How?", context: "Ruby 3.4" })).toBe("Context: Ruby 3.4\n\nQuery: How?");
		expect(options?.definition).toMatchObject({
			key: "librarian",
			model: "openai-codex/gpt-5.6-sol",
			reasoningEffort: "off",
			allowMcp: false,
			tools: [
				"checkout",
				"grep",
				"find",
				"read",
				"shell_command",
				"shell_command_status",
				"shell_command_cancel",
				"web_search_exa",
				"web_fetch_exa",
			],
		});
		expect(options?.toolbox?.(new BackgroundShellRegistry()).map((tool) => tool.name)).toEqual([
			"checkout",
			"shell_command",
			"shell_command_status",
			"shell_command_cancel",
		]);
	});

	it("formats a query without context", () => {
		expect(librarianMessage({ query: "Current Rails release?" })).toBe("Query: Current Rails release?");
	});

	it("maps context exhaustion to actionable guidance", () => {
		expect(mapLibrarianError(new Error("maximum context length exceeded")).message).toContain(
			"try a more specific query",
		);
		expect(mapLibrarianError(new Error("provider unavailable")).message).toContain("provider unavailable");
	});
});
