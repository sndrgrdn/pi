import { Value } from "typebox/value";
import { describe, expect, it, vi } from "vitest";
import { createWebFetchTool } from "./web-fetch.ts";

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function toolWithFetch(fetch: typeof globalThis.fetch) {
	return createWebFetchTool({
		fetch,
		authStorage: { get: () => ({ type: "api_key", key: "secret-that-must-not-leak" }) },
		env: {},
	});
}

describe("web_fetch tool", () => {
	it("maps the default batch request to Exa and returns Markdown", async () => {
		const fetch = vi.fn(async () =>
			jsonResponse({
				results: [
					{
						title: "Rails 8.1 released",
						url: "https://rubyonrails.org/2025/10/22/rails-8-1-0-has-been-released",
						publishedDate: "2025-10-22T00:00:00.000Z",
						author: "Rails team",
						text: "Rails 8.1 is now available.",
					},
				],
				statuses: [
					{
						id: "https://rubyonrails.org/2025/10/22/rails-8-1-0-has-been-released",
						status: "success",
					},
				],
			}),
		);
		const tool = createWebFetchTool({
			fetch,
			authStorage: { get: () => ({ type: "api_key", key: "stored-secret" }) },
			env: { EXA_API_KEY: "environment-secret" },
		});

		const result = await tool.execute(
			"call",
			{ urls: ["https://rubyonrails.org/2025/10/22/rails-8-1-0-has-been-released"] },
			undefined,
			undefined,
			{} as any,
		);

		expect(fetch).toHaveBeenCalledOnce();
		expect(fetch).toHaveBeenCalledWith(
			"https://api.exa.ai/contents",
			expect.objectContaining({
				method: "POST",
				headers: { "content-type": "application/json", "x-api-key": "stored-secret" },
				body: JSON.stringify({
					urls: ["https://rubyonrails.org/2025/10/22/rails-8-1-0-has-been-released"],
					text: { maxCharacters: 3000 },
				}),
			}),
		);
		expect(result.content).toEqual([
			{
				type: "text",
				text: [
					"# Rails 8.1 released",
					"URL: https://rubyonrails.org/2025/10/22/rails-8-1-0-has-been-released",
					"Published: 2025-10-22",
					"Author: Rails team",
					"",
					"Rails 8.1 is now available.",
				].join("\n"),
			},
		]);
	});

	it("preserves provider order and appends every failed URL in a mixed batch", async () => {
		const fetch = vi.fn(async () =>
			jsonResponse({
				requestId: "provider-internal-id",
				results: [
					{
						title: "First page",
						url: "https://first.example",
						text: "First content",
					},
					{
						title: null,
						url: "https://second.example",
						publishedDate: null,
						author: null,
						text: "Second content",
					},
				],
				statuses: [
					{ id: "https://first.example", status: "success" },
					{
						id: "https://unsupported.example",
						status: "error",
						error: { tag: "UNSUPPORTED_URL", httpStatusCode: null },
					},
					{ id: "https://second.example", status: "success" },
					{ id: "https://missing.example", status: "error", error: { tag: "CRAWL_NOT_FOUND" } },
				],
				costDollars: { total: 0.01 },
			}),
		);
		const tool = createWebFetchTool({
			fetch,
			authStorage: { get: () => ({ type: "api_key", key: "secret" }) },
			env: {},
		});

		const result = await tool.execute(
			"call",
			{
				urls: [
					"https://first.example",
					"https://unsupported.example",
					"https://second.example",
					"https://missing.example",
				],
				maxCharacters: 500,
			},
			undefined,
			undefined,
			{} as any,
		);

		const request = fetch.mock.calls[0] as unknown as Parameters<typeof globalThis.fetch>;
		expect(JSON.parse(request[1]?.body as string)).toEqual({
			urls: [
				"https://first.example",
				"https://unsupported.example",
				"https://second.example",
				"https://missing.example",
			],
			text: { maxCharacters: 500 },
		});
		expect(result.content[0]).toMatchObject({
			type: "text",
			text: [
				"# First page\nURL: https://first.example\n\nFirst content",
				"# (no title)\nURL: https://second.example\n\nSecond content",
				"Error fetching https://unsupported.example: UNSUPPORTED_URL",
				"Error fetching https://missing.example: CRAWL_NOT_FOUND",
			].join("\n\n"),
		});
		expect(JSON.stringify(result)).not.toMatch(/provider-internal-id|costDollars/);
	});

	it("returns a tool error when every URL fails", async () => {
		const tool = createWebFetchTool({
			fetch: vi.fn(async () =>
				jsonResponse({
					results: [],
					statuses: [
						{ id: "https://missing.example", status: "error", error: { tag: "CRAWL_NOT_FOUND" } },
						{ id: "ftp://unsupported.example", status: "error", error: { tag: "UNSUPPORTED_URL" } },
					],
				}),
			),
			authStorage: { get: () => ({ type: "api_key", key: "secret" }) },
			env: {},
		});

		await expect(
			tool.execute(
				"call",
				{ urls: ["https://missing.example", "ftp://unsupported.example"] },
				undefined,
				undefined,
				{} as any,
			),
		).rejects.toMatchObject({
			code: "empty_results",
			message: expect.stringContaining(
				"https://missing.example: CRAWL_NOT_FOUND; ftp://unsupported.example: UNSUPPORTED_URL",
			),
		});
	});

	it.each([
		[{ urls: [] }, "non-empty urls array"],
		[{ urls: "https://example.com" }, "non-empty urls array"],
		[{ urls: ["https://example.com"], maxCharacters: 0 }, "positive maxCharacters"],
		[{ urls: ["https://example.com"], maxCharacters: -1 }, "positive maxCharacters"],
	])("rejects invalid input before network activity", async (params, message) => {
		const fetch = vi.fn();
		const tool = createWebFetchTool({
			fetch,
			authStorage: { get: () => ({ type: "api_key", key: "stored-secret" }) },
			env: {},
		});

		await expect(tool.execute("call", params as any, undefined, undefined, {} as any)).rejects.toThrow(message);
		expect(fetch).not.toHaveBeenCalled();
		expect(Value.Check(tool.parameters, params)).toBe(false);
	});

	it("falls back to EXA_API_KEY and fails without credentials before network activity", async () => {
		const fetch = vi.fn(async () =>
			jsonResponse({
				results: [{ title: "Example", url: "https://example.com", text: "Example content" }],
				statuses: [{ id: "https://example.com", status: "success" }],
			}),
		);
		const fromEnvironment = createWebFetchTool({
			fetch,
			authStorage: { get: () => undefined },
			env: { EXA_API_KEY: "environment-secret" },
		});

		await fromEnvironment.execute("call", { urls: ["https://example.com"] }, undefined, undefined, {} as any);
		const request = fetch.mock.calls[0] as unknown as Parameters<typeof globalThis.fetch>;
		expect(request[1]?.headers).toEqual({
			"content-type": "application/json",
			"x-api-key": "environment-secret",
		});

		fetch.mockClear();
		const withoutCredentials = createWebFetchTool({ fetch, authStorage: { get: () => undefined }, env: {} });
		await expect(
			withoutCredentials.execute("call", { urls: ["https://example.com"] }, undefined, undefined, {} as any),
		).rejects.toMatchObject({ code: "credentials_missing", message: expect.stringContaining("EXA_API_KEY") });
		expect(fetch).not.toHaveBeenCalled();
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
		[
			"malformed shape",
			async () => jsonResponse({ results: "wrong", statuses: [] }),
			"malformed response",
			"malformed_response",
		],
		[
			"error status without a reason",
			async () => jsonResponse({ results: [], statuses: [{ id: "https://example.com", status: "error" }] }),
			"malformed response",
			"malformed_response",
		],
		[
			"unknown status",
			async () => jsonResponse({ results: [], statuses: [{ id: "https://example.com", status: "pending" }] }),
			"malformed response",
			"malformed_response",
		],
	] as const)("reports concise %s errors without credential leakage", async (_case, fetch, message, code) => {
		let thrown: Error | undefined;
		try {
			await toolWithFetch(fetch as typeof globalThis.fetch).execute(
				"call",
				{ urls: ["https://example.com"] },
				undefined,
				undefined,
				{} as any,
			);
		} catch (error) {
			thrown = error as Error;
		}

		expect(thrown?.message).toContain(message);
		expect(thrown?.message).not.toContain("secret-that-must-not-leak");
		expect(thrown).toMatchObject({ code });
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
			const pending = toolWithFetch(fetch).execute(
				"call",
				{ urls: ["https://example.com"] },
				undefined,
				undefined,
				{} as any,
			);
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
		const pending = toolWithFetch(fetch).execute(
			"call",
			{ urls: ["https://example.com"] },
			parent.signal,
			undefined,
			{} as any,
		);

		parent.abort();

		await expect(pending).rejects.toThrow("cancelled");
		expect(fetch).toHaveBeenCalledOnce();
	});
});
