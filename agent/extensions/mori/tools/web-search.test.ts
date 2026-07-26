import { Value } from "typebox/value";
import { describe, expect, it, vi } from "vitest";
import { createWebSearchTool } from "./web-search.ts";

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function toolWithFetch(fetch: typeof globalThis.fetch) {
	return createWebSearchTool({
		fetch,
		getCredential: () => ({ type: "api_key", key: "secret-that-must-not-leak" }),
		env: {},
	});
}

describe("web_search tool", () => {
	it("maps the default search request to Exa and returns Markdown", async () => {
		const fetch = vi.fn(async () =>
			jsonResponse({
				results: [
					{
						title: "Rails 8.1 released",
						url: "https://rubyonrails.org/2025/10/22/rails-8-1-0-has-been-released",
						publishedDate: "2025-10-22T00:00:00.000Z",
						author: "Rails team",
						highlights: ["Rails 8.1 is now available."],
					},
				],
			}),
		);
		const tool = createWebSearchTool({
			fetch,
			getCredential: () => ({ type: "api_key", key: "stored-secret" }),
			env: {},
		});

		const result = await tool.execute("call", { query: "Rails 8.1 release" }, undefined, undefined, {} as any);

		expect(fetch).toHaveBeenCalledOnce();
		expect(fetch).toHaveBeenCalledWith(
			"https://api.exa.ai/search",
			expect.objectContaining({
				method: "POST",
				headers: { "content-type": "application/json", "x-api-key": "stored-secret" },
				body: JSON.stringify({
					query: "Rails 8.1 release",
					type: "auto",
					numResults: 10,
					contents: { highlights: true },
				}),
			}),
		);
		expect(result.content).toEqual([
			{
				type: "text",
				text: [
					"## 1. Rails 8.1 released",
					"**URL:** https://rubyonrails.org/2025/10/22/rails-8-1-0-has-been-released",
					"**Published:** 2025-10-22T00:00:00.000Z",
					"**Author:** Rails team",
					"**Highlights:**",
					"- Rails 8.1 is now available.",
				]
					.join("\n\n")
					.replace("**Highlights:**\n\n-", "**Highlights:**\n-"),
			},
		]);
		expect(result.details).toEqual({ resultCount: 1 });
	});

	it("maps an explicit result count to Exa", async () => {
		const fetch = vi.fn(async () => jsonResponse({ results: [{ title: "Example", url: "https://example.com" }] }));
		const tool = toolWithFetch(fetch);

		await tool.execute("call", { query: "example", numResults: 3 }, undefined, undefined, {} as any);

		expect(fetch).toHaveBeenCalledWith(
			"https://api.exa.ai/search",
			expect.objectContaining({
				body: JSON.stringify({ query: "example", type: "auto", numResults: 3, contents: { highlights: true } }),
			}),
		);
	});

	it.each([
		[{ query: "" }, "non-empty query"],
		[{ query: "   " }, "non-empty query"],
		[{ query: "Rails", numResults: 0 }, "numResults"],
		[{ query: "Rails", numResults: 101 }, "numResults"],
		[{ query: "Rails", numResults: 1.5 }, "numResults"],
	])("rejects invalid input before network activity", async (params, message) => {
		const fetch = vi.fn();
		const tool = createWebSearchTool({
			fetch,
			getCredential: () => ({ type: "api_key", key: "stored-secret" }),
			env: {},
		});

		await expect(tool.execute("call", params, undefined, undefined, {} as any)).rejects.toMatchObject({
			name: "WebSearchError",
			code: "invalid_input",
			message: expect.stringMatching(new RegExp(`^web_search .*${message}`)),
		});
		expect(fetch).not.toHaveBeenCalled();
		expect(Value.Check(tool.parameters, params)).toBe(false);
	});

	it("preserves provider order and omits unavailable metadata", async () => {
		const tool = createWebSearchTool({
			fetch: vi.fn(async () =>
				jsonResponse({
					costDollars: { total: 0.01 },
					results: [
						{
							id: "exa-internal-id",
							score: 0.99,
							title: "First result",
							url: "https://first.example",
							highlights: ["First point", "Second point"],
						},
						{
							title: "Second result",
							url: "https://second.example",
							author: null,
							publishedDate: null,
							highlights: [],
						},
					],
				}),
			),
			getCredential: () => ({ type: "api_key", key: "secret" }),
			env: {},
		});

		const result = await tool.execute("call", { query: "example" }, undefined, undefined, {} as any);

		expect(result.content[0]).toMatchObject({
			type: "text",
			text: [
				"## 1. First result",
				"**URL:** https://first.example",
				"**Highlights:**\n- First point\n- Second point",
				"## 2. Second result",
				"**URL:** https://second.example",
			].join("\n\n"),
		});
		expect(JSON.stringify(result)).not.toMatch(/exa-internal-id|0\.99|costDollars/);
	});

	it.each([
		[
			"a malformed result collection",
			async () => jsonResponse({ results: "wrong" }),
			"received a malformed response.",
			"malformed_response",
		],
		[
			"a result without identity fields",
			async () => jsonResponse({ results: [{}] }),
			"received a malformed response.",
			"malformed_response",
		],
		[
			"an empty result collection",
			async () => jsonResponse({ results: [] }),
			"returned no results.",
			"empty_results",
		],
	] as const)("reports %s as a coded web_search error", async (_case, fetch, message, code) => {
		const tool = toolWithFetch(fetch as typeof globalThis.fetch);

		await expect(tool.execute("call", { query: "example" }, undefined, undefined, {} as any)).rejects.toMatchObject({
			name: "WebSearchError",
			code,
			message: `web_search ${message}`,
		});
	});
});
