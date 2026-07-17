import { Value } from "typebox/value";
import { describe, expect, it, vi } from "vitest";
import { createWebFetchTool } from "./web-fetch.ts";

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

function toolWithFetch(fetch: typeof globalThis.fetch) {
	return createWebFetchTool({
		fetch,
		getCredential: () => ({ type: "api_key", key: "secret" }),
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
		const tool = toolWithFetch(fetch);

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
				headers: { "content-type": "application/json", "x-api-key": "secret" },
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
		expect(result.details).toEqual({ resultCount: 1 });
	});

	it("preserves provider order and appends every failed URL in a mixed batch", async () => {
		const fetch = vi.fn(async () =>
			jsonResponse({
				requestId: "provider-internal-id",
				results: [
					{ title: "First page", url: "https://first.example", text: "First content" },
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
		const tool = toolWithFetch(fetch);

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
				"https://first.example/",
				"https://unsupported.example/",
				"https://second.example/",
				"https://missing.example/",
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

	it("retains successful pages when provider error details are absent", async () => {
		const tool = toolWithFetch(
			vi.fn(async () =>
				jsonResponse({
					results: [{ title: "Available", url: "https://available.example", text: "Useful content" }],
					statuses: [
						{ id: "https://available.example", status: "success" },
						{ id: "https://no-details.example", status: "error" },
						{
							id: "https://no-tag.example",
							status: "error",
							error: { httpStatusCode: 502 },
						},
					],
				}),
			),
		);

		const result = await tool.execute(
			"call",
			{
				urls: ["https://available.example", "https://no-details.example", "https://no-tag.example"],
			},
			undefined,
			undefined,
			{} as any,
		);

		expect(result.content[0]).toMatchObject({
			text: [
				"# Available\nURL: https://available.example\n\nUseful content",
				"Error fetching https://no-details.example: unknown error",
				"Error fetching https://no-tag.example: unknown error",
			].join("\n\n"),
		});
		expect(result.details).toEqual({ resultCount: 1 });
	});

	it("reports blank pages explicitly without discarding non-empty pages", async () => {
		const tool = toolWithFetch(
			vi.fn(async () =>
				jsonResponse({
					results: [
						{ title: "Empty", url: "https://empty.example", text: " \n\t " },
						{ title: "Available", url: "https://available.example", text: "Useful content" },
					],
					statuses: [
						{ id: "https://empty.example", status: "success" },
						{ id: "https://available.example", status: "success" },
					],
				}),
			),
		);

		const result = await tool.execute(
			"call",
			{ urls: ["https://empty.example", "https://available.example"] },
			undefined,
			undefined,
			{} as any,
		);

		expect(result.content[0]).toMatchObject({
			text: [
				"# Available\nURL: https://available.example\n\nUseful content",
				"Error fetching https://empty.example: empty content",
			].join("\n\n"),
		});
		expect(result.details).toEqual({ resultCount: 1 });
	});

	it.each([
		[
			"failed statuses",
			{
				results: [],
				statuses: [
					{ id: "https://missing.example", status: "error", error: { tag: "CRAWL_NOT_FOUND" } },
					{ id: "https://unknown.example", status: "error" },
				],
			},
			["https://missing.example", "https://unknown.example"],
			"https://missing.example: CRAWL_NOT_FOUND; https://unknown.example: unknown error",
		],
		[
			"blank pages",
			{
				results: [
					{ title: "Empty", url: "https://empty.example", text: "" },
					{ title: "Blank", url: "https://blank.example", text: "  \n " },
				],
				statuses: [
					{ id: "https://empty.example", status: "success" },
					{ id: "https://blank.example", status: "success" },
				],
			},
			["https://empty.example", "https://blank.example"],
			"https://empty.example: empty content; https://blank.example: empty content",
		],
		["no content", { results: [], statuses: [] }, ["https://missing.example"], "returned no content"],
	] as const)("returns an empty_results tool error for all-%s responses", async (_case, response, urls, message) => {
		const tool = toolWithFetch(vi.fn(async () => jsonResponse(response)));

		await expect(tool.execute("call", { urls: [...urls] }, undefined, undefined, {} as any)).rejects.toMatchObject({
			name: "WebFetchError",
			code: "empty_results",
			message: expect.stringContaining(message),
		});
	});

	it.each([
		[{ urls: [] }, "non-empty urls array"],
		[{ urls: "https://example.com" }, "non-empty urls array"],
		[{ urls: ["https://example.com"], maxCharacters: 0 }, "positive maxCharacters"],
		[{ urls: ["https://example.com"], maxCharacters: -1 }, "positive maxCharacters"],
	])("rejects schema-invalid input before network activity", async (params, message) => {
		const fetch = vi.fn();
		const tool = toolWithFetch(fetch);

		await expect(tool.execute("call", params as any, undefined, undefined, {} as any)).rejects.toMatchObject({
			name: "WebFetchError",
			code: "invalid_input",
			message: expect.stringContaining(message),
		});
		expect(fetch).not.toHaveBeenCalled();
		expect(Value.Check(tool.parameters, params)).toBe(false);
	});

	it.each([
		[["https://valid.example", ""], "urls[1] is empty"],
		[["not a URL"], "urls[0] is malformed"],
		[["ftp://user:credential-that-must-not-leak@example.com/private"], 'unsupported scheme "ftp:"'],
	])("rejects invalid URL values before network activity", async (urls, message) => {
		const fetch = vi.fn();
		const tool = toolWithFetch(fetch);

		let thrown: Error | undefined;
		try {
			await tool.execute("call", { urls }, undefined, undefined, {} as any);
		} catch (error) {
			thrown = error as Error;
		}

		expect(thrown).toMatchObject({
			name: "WebFetchError",
			code: "invalid_input",
			message: expect.stringContaining(message),
		});
		expect(thrown?.message).toContain("HTTP");
		expect(thrown?.message).not.toContain("credential-that-must-not-leak");
		expect(fetch).not.toHaveBeenCalled();
		expect(Value.Check(tool.parameters, { urls })).toBe(true);
	});

	it("passes parsed, normalized URLs to the provider", async () => {
		const fetch = vi.fn(async () =>
			jsonResponse({
				results: [{ title: "Page", url: "https://example.com/page", text: "Content" }],
				statuses: [{ id: "https://example.com/page", status: "success" }],
			}),
		);
		const tool = toolWithFetch(fetch);

		await tool.execute("call", { urls: ["https://EXAMPLE.com:443/path/../page"] }, undefined, undefined, {} as any);

		const request = fetch.mock.calls[0] as unknown as Parameters<typeof globalThis.fetch>;
		expect(JSON.parse(request[1]?.body as string).urls).toEqual(["https://example.com/page"]);
	});

	it.each([
		["wrong results", { results: "wrong", statuses: [] }],
		[
			"invalid error details",
			{
				results: [],
				statuses: [{ id: "https://example.com", status: "error", error: { tag: 123 } }],
			},
		],
		["unknown status", { results: [], statuses: [{ id: "https://example.com", status: "pending" }] }],
	] as const)("rejects malformed provider shapes: %s", async (_case, response) => {
		const tool = toolWithFetch(vi.fn(async () => jsonResponse(response)));

		await expect(
			tool.execute("call", { urls: ["https://example.com"] }, undefined, undefined, {} as any),
		).rejects.toMatchObject({
			name: "WebFetchError",
			code: "malformed_response",
			message: "web_fetch received a malformed response.",
		});
	});
});
