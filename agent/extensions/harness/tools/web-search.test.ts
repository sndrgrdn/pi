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
		authStorage: { get: () => ({ type: "api_key", key: "secret-that-must-not-leak" }) },
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
			authStorage: { get: () => ({ type: "api_key", key: "stored-secret" }) },
			env: { EXA_API_KEY: "environment-secret" },
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
			authStorage: { get: () => ({ type: "api_key", key: "stored-secret" }) },
			env: {},
		});

		await expect(tool.execute("call", params, undefined, undefined, {} as any)).rejects.toThrow(message);
		expect(fetch).not.toHaveBeenCalled();
		expect(Value.Check(tool.parameters, params)).toBe(false);
	});

	it("falls back to EXA_API_KEY and fails without credentials before network activity", async () => {
		const fetch = vi.fn(async () => jsonResponse({ results: [{ url: "https://example.com" }] }));
		const fromEnvironment = createWebSearchTool({
			fetch,
			authStorage: { get: () => undefined },
			env: { EXA_API_KEY: "environment-secret" },
		});

		await fromEnvironment.execute("call", { query: "example", numResults: 3 }, undefined, undefined, {} as any);
		const request = fetch.mock.calls[0] as unknown as Parameters<typeof globalThis.fetch>;
		expect(request[1]?.headers).toEqual({
			"content-type": "application/json",
			"x-api-key": "environment-secret",
		});
		expect(request[1]?.body).toBe(
			JSON.stringify({ query: "example", type: "auto", numResults: 3, contents: { highlights: true } }),
		);

		fetch.mockClear();
		const withoutCredentials = createWebSearchTool({
			fetch,
			authStorage: { get: () => undefined },
			env: {},
		});
		await expect(
			withoutCredentials.execute("call", { query: "example" }, undefined, undefined, {} as any),
		).rejects.toMatchObject({ code: "credentials_missing", message: expect.stringContaining("EXA_API_KEY") });
		expect(fetch).not.toHaveBeenCalled();
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
							url: "https://first.example",
							highlights: ["First point", "Second point"],
						},
						{ title: "Second result", author: null, publishedDate: null, highlights: [] },
					],
				}),
			),
			authStorage: { get: () => ({ type: "api_key", key: "secret" }) },
			env: {},
		});

		const result = await tool.execute("call", { query: "example" }, undefined, undefined, {} as any);

		expect(result.content[0]).toMatchObject({
			type: "text",
			text: [
				"## 1",
				"**URL:** https://first.example",
				"**Highlights:**\n- First point\n- Second point",
				"## 2. Second result",
			].join("\n\n"),
		});
		expect(JSON.stringify(result)).not.toMatch(/exa-internal-id|0\.99|costDollars/);
	});

	it.each([
		[
			"authentication",
			async () => jsonResponse({ error: "bad secret-that-must-not-leak" }, 401),
			"authentication failed",
			"authentication",
		],
		["rate limit", async () => jsonResponse({ error: "slow down" }, 429), "rate limit exceeded", "rate_limit"],
		["API", async () => jsonResponse({ error: "server failed" }, 500), "request failed (HTTP 500)", "upstream"],
		[
			"transport",
			async () => Promise.reject(new Error("socket secret-that-must-not-leak")),
			"network request failed",
			"transport",
		],
		["malformed JSON", async () => new Response("not json"), "malformed response", "malformed_response"],
		["malformed shape", async () => jsonResponse({ results: "wrong" }), "malformed response", "malformed_response"],
		["empty results", async () => jsonResponse({ results: [] }), "returned no results", "empty_results"],
	] as const)("reports concise %s errors without credential leakage", async (_case, fetch, message, code) => {
		const tool = toolWithFetch(fetch as typeof globalThis.fetch);

		let failure: Error | undefined;
		try {
			await tool.execute("call", { query: "example" }, undefined, undefined, {} as any);
		} catch (error) {
			failure = error as Error;
		}

		expect(failure?.message).toContain(message);
		expect(failure?.message).not.toContain("secret-that-must-not-leak");
		expect(failure).toMatchObject({ code });
	});

	it("times out after 30 seconds without retrying", async () => {
		vi.useFakeTimers();
		try {
			const fetch = vi.fn(
				async (_url: string | URL | Request, init?: RequestInit) =>
					new Promise<Response>((_resolve, reject) => {
						init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
					}),
			);
			const pending = toolWithFetch(fetch).execute("call", { query: "example" }, undefined, undefined, {} as any);
			const rejection = expect(pending).rejects.toThrow("timed out after 30 seconds");

			await vi.advanceTimersByTimeAsync(30_000);

			await rejection;
			expect(fetch).toHaveBeenCalledOnce();
		} finally {
			vi.useRealTimers();
		}
	});

	it("honors parent cancellation without retrying", async () => {
		const fetch = vi.fn(
			async (_url: string | URL | Request, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
				}),
		);
		const parent = new AbortController();
		const pending = toolWithFetch(fetch).execute("call", { query: "example" }, parent.signal, undefined, {} as any);

		parent.abort();

		await expect(pending).rejects.toThrow("cancelled");
		expect(fetch).toHaveBeenCalledOnce();
	});
});
