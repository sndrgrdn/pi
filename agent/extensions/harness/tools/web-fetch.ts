import { type AuthStorage, defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { createHarnessAuthStorage } from "../runner.ts";

interface WebFetchDependencies {
	fetch: typeof globalThis.fetch;
	authStorage: Pick<AuthStorage, "get">;
	env: { EXA_API_KEY?: string };
}

type WebFetchFailureCode =
	| "invalid_input"
	| "credentials_missing"
	| "cancelled"
	| "timeout"
	| "authentication"
	| "rate_limit"
	| "upstream"
	| "transport"
	| "malformed_response"
	| "empty_results";

class WebFetchError extends Error {
	readonly code: WebFetchFailureCode;
	constructor(code: WebFetchFailureCode, message: string) {
		super(message);
		this.name = "WebFetchError";
		this.code = code;
	}
}

const parameters = Type.Object(
	{
		urls: Type.Array(Type.String(), {
			minItems: 1,
			description: "URLs to read. Batch multiple URLs in one call.",
		}),
		maxCharacters: Type.Optional(
			Type.Number({
				exclusiveMinimum: 0,
				description: "Maximum characters to extract per page (default: 3000).",
			}),
		),
	},
	{ additionalProperties: false },
);

const optionalString = Type.Optional(Type.Union([Type.String(), Type.Null()]));
const exaResponse = Type.Object({
	results: Type.Array(
		Type.Object({
			title: optionalString,
			url: Type.String({ minLength: 1 }),
			publishedDate: optionalString,
			author: optionalString,
			text: Type.String(),
		}),
	),
	statuses: Type.Array(
		Type.Object({
			id: Type.String({ minLength: 1 }),
			status: Type.String(),
			error: Type.Optional(
				Type.Object({
					tag: Type.String({ minLength: 1 }),
					httpStatusCode: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
				}),
			),
		}),
	),
});

const defaultDependencies = (): WebFetchDependencies => ({
	fetch: globalThis.fetch,
	authStorage: createHarnessAuthStorage(),
	env: process.env,
});

const TIMEOUT_ABORT = Symbol("timeout abort");

function formatPage(page: {
	title?: string | null;
	url: string;
	publishedDate?: string | null;
	author?: string | null;
	text: string;
}): string {
	return [
		`# ${page.title || "(no title)"}`,
		`URL: ${page.url}`,
		...(page.publishedDate ? [`Published: ${page.publishedDate.split("T")[0]}`] : []),
		...(page.author ? [`Author: ${page.author}`] : []),
		"",
		page.text,
	].join("\n");
}

function formatFailure(status: { id: string; error?: { tag: string } }): string {
	return `Error fetching ${status.id}: ${status.error?.tag ?? "unknown error"}`;
}

function failure(code: WebFetchFailureCode, message: string): WebFetchError {
	return new WebFetchError(code, `web_fetch ${message}`);
}

function abortFailure(signal: AbortSignal): WebFetchError {
	return signal.reason === TIMEOUT_ABORT
		? failure("timeout", "timed out after 30 seconds.")
		: failure("cancelled", "was cancelled.");
}

export function createWebFetchTool(dependencies: WebFetchDependencies = defaultDependencies()) {
	return defineTool({
		name: "web_fetch",
		label: "web_fetch",
		description:
			"Read a webpage's full content as clean markdown. Use after web_search when highlights are insufficient or to read any URL.\n\nBest for: Extracting full content from known URLs. Batch multiple URLs in one call.\nReturns: Clean text content and metadata from the page(s).",
		parameters,
		async execute(_id, params, signal) {
			if (!Value.Check(parameters, params))
				throw failure("invalid_input", "requires a non-empty urls array and a positive maxCharacters.");
			const credential = dependencies.authStorage.get("exa");
			const apiKey = credential?.type === "api_key" ? credential.key : dependencies.env.EXA_API_KEY;
			if (!apiKey)
				throw failure("credentials_missing", "requires an `exa` API key in Pi AuthStorage or EXA_API_KEY.");
			if (signal?.aborted) throw failure("cancelled", "was cancelled.");
			const request = new AbortController();
			const cancel = () => request.abort();
			signal?.addEventListener("abort", cancel, { once: true });
			const timeout = setTimeout(() => request.abort(TIMEOUT_ABORT), 30_000);
			try {
				let value: unknown;
				try {
					const response = await dependencies.fetch("https://api.exa.ai/contents", {
						method: "POST",
						headers: { "content-type": "application/json", "x-api-key": apiKey },
						body: JSON.stringify({
							urls: params.urls,
							text: { maxCharacters: params.maxCharacters ?? 3000 },
						}),
						signal: request.signal,
					});
					if (!response.ok) {
						if (response.status === 401 || response.status === 403)
							throw failure("authentication", "authentication failed.");
						if (response.status === 429) throw failure("rate_limit", "rate limit exceeded.");
						throw failure("upstream", `request failed (HTTP ${response.status}).`);
					}
					try {
						value = await response.json();
					} catch {
						throw failure("malformed_response", "received a malformed response.");
					}
				} catch (error) {
					if (request.signal.aborted) throw abortFailure(request.signal);
					throw error instanceof WebFetchError ? error : failure("transport", "network request failed.");
				}
				if (!Value.Check(exaResponse, value)) throw failure("malformed_response", "received a malformed response.");
				const failures = value.statuses.filter((status) => status.status === "error");
				if (value.results.length === 0) {
					const reasons = failures
						.map((status) => `${status.id}: ${status.error?.tag ?? "unknown error"}`)
						.join("; ");
					throw failure(
						"empty_results",
						reasons ? `failed to fetch every URL: ${reasons}.` : "returned no content.",
					);
				}
				return {
					content: [
						{
							type: "text",
							text: [...value.results.map(formatPage), ...failures.map(formatFailure)].join("\n\n"),
						},
					],
					details: { resultCount: value.results.length },
				};
			} finally {
				clearTimeout(timeout);
				signal?.removeEventListener("abort", cancel);
			}
		},
	});
}
