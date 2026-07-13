import { describe, expect, it, vi } from "vitest";
import { BUILTIN_PROFILES } from "../profiles.ts";
import type { RunOptions } from "../runner.ts";
import { BackgroundShellRegistry } from "../shell/registry.ts";
import { createLibrarianTool } from "./librarian.ts";

describe("librarian tool", () => {
	it("prepends optional context and returns the final answer envelope", async () => {
		const run = vi.fn(async (options: RunOptions<{ query: string; context?: string }>) => {
			options.onAction?.("checkout");
			options.onAction?.("checkout");
			return options.wrapResult("library-1", "Use [the source](https://example.com).");
		});
		const tool = createLibrarianTool({ run } as any, BUILTIN_PROFILES);
		const updates: any[] = [];
		const result = await tool.execute(
			"call",
			{ query: "How?", context: "Ruby 3.4" },
			undefined,
			(update: any) => updates.push(update),
			{ cwd: "/repo" } as any,
		);
		expect(updates.at(-1)?.details).toEqual({ trace: { state: "running" }, actions: { checkout: 2 } });
		expect(result.details).toEqual({ trace: { state: "success" } });
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

	it("formats a query without context", async () => {
		const run = vi.fn(async (options: RunOptions<{ query: string }>) =>
			options.wrapResult("library-2", "Rails 8.1."),
		);
		const tool = createLibrarianTool({ run } as any, BUILTIN_PROFILES);

		await tool.execute("call", { query: "Current Rails release?" }, undefined, undefined, { cwd: "/repo" } as any);

		const options = run.mock.calls[0]?.[0];
		expect(options?.mapInput({ query: "Current Rails release?" })).toBe("Query: Current Rails release?");
	});

	it("maps context exhaustion to actionable guidance", async () => {
		const run = vi.fn().mockRejectedValue(new Error("maximum context length exceeded"));
		const tool = createLibrarianTool({ run } as any, BUILTIN_PROFILES);

		await expect(
			tool.execute("call", { query: "How?" }, undefined, undefined, { cwd: "/repo" } as any),
		).rejects.toThrow("Librarian exhausted its context window; try a more specific query.");
	});

	it("rethrows unrelated run failures untouched", async () => {
		const run = vi.fn().mockRejectedValue(new Error("provider unavailable"));
		const tool = createLibrarianTool({ run } as any, BUILTIN_PROFILES);

		await expect(
			tool.execute("call", { query: "How?" }, undefined, undefined, { cwd: "/repo" } as any),
		).rejects.toThrow("provider unavailable");
	});
});
