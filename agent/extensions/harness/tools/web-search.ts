import { type AuthStorage, defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { createHarnessAuthStorage } from "../runner.ts";

interface WebSearchDependencies {
	fetch: typeof globalThis.fetch;
	authStorage: Pick<AuthStorage, "get">;
	env: { EXA_API_KEY?: string };
}

interface WebSearchResult {
	title: string;
	url: string;
	publishedDate?: string;
	author?: string;
	highlights?: string[];
}

const parameters = Type.Object(
	{
		query: Type.String({
			minLength: 1,
			pattern: "\\S",
			description: "Natural-language description of the ideal page, not just keywords.",
		}),
		numResults: Type.Optional(
			Type.Integer({
				minimum: 1,
				maximum: 100,
				description: "Number of search results to return (default: 10).",
			}),
		),
	},
	{ additionalProperties: false },
);

const optionalString = Type.Optional(Type.Union([Type.String(), Type.Null()]));
const exaResponse = Type.Object({
	results: Type.Array(
		Type.Object({
			title: Type.String({ minLength: 1 }),
			url: Type.String({ minLength: 1 }),
			publishedDate: optionalString,
			author: optionalString,
			highlights: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Null()])),
		}),
	),
});

interface ExaSearchRequest {
	query: string;
	numResults: number;
}

type WebSearchFailureCode =
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

class WebSearchError extends Error {
	readonly code: WebSearchFailureCode;
	constructor(code: WebSearchFailureCode, message: string) {
		super(message);
		this.name = "WebSearchError";
		this.code = code;
	}
}

const TIMEOUT_ABORT = Symbol("timeout abort");

const defaultDependencies = (): WebSearchDependencies => ({
	fetch: globalThis.fetch,
	authStorage: createHarnessAuthStorage(),
	env: process.env,
});

function formatResult(result: WebSearchResult, index: number): string {
	const heading = `## ${index + 1}. ${result.title}`;
	return [
		heading,
		`**URL:** ${result.url}`,
		...(result.publishedDate ? [`**Published:** ${result.publishedDate}`] : []),
		...(result.author ? [`**Author:** ${result.author}`] : []),
		...(result.highlights?.length
			? [`**Highlights:**\n${result.highlights.map((highlight) => `- ${highlight}`).join("\n")}`]
			: []),
	].join("\n\n");
}

function failure(code: WebSearchFailureCode, message: string): WebSearchError {
	return new WebSearchError(code, `web_search ${message}`);
}

function parseSearchResponse(value: unknown): WebSearchResult[] {
	if (!Value.Check(exaResponse, value)) throw failure("malformed_response", "received a malformed response.");
	const results = value.results.map(
		(result): WebSearchResult => ({
			title: result.title,
			url: result.url,
			...(result.publishedDate ? { publishedDate: result.publishedDate } : {}),
			...(result.author ? { author: result.author } : {}),
			...(result.highlights?.length ? { highlights: [...result.highlights] } : {}),
		}),
	);
	if (results.length === 0) throw failure("empty_results", "returned no results.");
	return results;
}

function abortFailure(signal: AbortSignal): WebSearchError {
	return signal.reason === TIMEOUT_ABORT
		? failure("timeout", "timed out after 30 seconds.")
		: failure("cancelled", "was cancelled.");
}

async function searchExa(
	dependencies: WebSearchDependencies,
	apiKey: string,
	params: ExaSearchRequest,
	signal: AbortSignal,
): Promise<{ ok: true; results: WebSearchResult[] } | { ok: false; error: WebSearchError }> {
	try {
		const response = await dependencies.fetch("https://api.exa.ai/search", {
			method: "POST",
			headers: { "content-type": "application/json", "x-api-key": apiKey },
			body: JSON.stringify({
				query: params.query,
				type: "auto",
				numResults: params.numResults,
				contents: { highlights: true },
			}),
			signal,
		});
		if (!response.ok) {
			if (response.status === 401 || response.status === 403)
				throw failure("authentication", "authentication failed.");
			if (response.status === 429) throw failure("rate_limit", "rate limit exceeded.");
			throw failure("upstream", `request failed (HTTP ${response.status}).`);
		}
		let value: unknown;
		try {
			value = await response.json();
		} catch {
			throw failure("malformed_response", "received a malformed response.");
		}
		return { ok: true, results: parseSearchResponse(value) };
	} catch (error) {
		if (signal.aborted) return { ok: false, error: abortFailure(signal) };
		return {
			ok: false,
			error: error instanceof WebSearchError ? error : failure("transport", "network request failed."),
		};
	}
}

export function createWebSearchTool(dependencies: WebSearchDependencies = defaultDependencies()) {
	return defineTool({
		name: "web_search",
		label: "web_search",
		description:
			"Search the web for any topic and get clean, ready-to-use content. Best for finding current information, news, facts, people, companies, or answers. Describe the ideal page rather than using only keywords.",
		parameters,
		async execute(_id, params, signal) {
			if (!Value.Check(parameters, params))
				throw failure("invalid_input", "requires a non-empty query and numResults from 1 to 100.");
			const searchRequest: ExaSearchRequest = {
				query: params.query.trim(),
				numResults: params.numResults ?? 10,
			};
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
				const outcome = await searchExa(dependencies, apiKey, searchRequest, request.signal);
				if (!outcome.ok) throw outcome.error;
				return {
					content: [{ type: "text", text: outcome.results.map(formatResult).join("\n\n") }],
					details: { resultCount: outcome.results.length },
				};
			} finally {
				clearTimeout(timeout);
				signal?.removeEventListener("abort", cancel);
			}
		},
	});
}
