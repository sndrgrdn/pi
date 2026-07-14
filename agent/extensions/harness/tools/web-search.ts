import { join } from "node:path";
import { AuthStorage, getAgentDir, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

interface WebSearchDependencies {
	fetch: typeof globalThis.fetch;
	authStorage: Pick<AuthStorage, "get">;
	env: { EXA_API_KEY?: string };
}

interface ExaSearchResult {
	title?: string;
	url?: string;
	publishedDate?: string;
	author?: string;
	highlights?: string[];
}

interface ExaSearchResponse {
	results: ExaSearchResult[];
}

const defaultDependencies = (): WebSearchDependencies => ({
	fetch: globalThis.fetch,
	authStorage: AuthStorage.create(join(getAgentDir(), "auth.json")),
	env: process.env,
});

function formatResult(result: ExaSearchResult, index: number): string {
	const heading = result.title ? `## ${index + 1}. ${result.title}` : `## ${index + 1}`;
	return [
		heading,
		...(result.url ? [`**URL:** ${result.url}`] : []),
		...(result.publishedDate ? [`**Published:** ${result.publishedDate}`] : []),
		...(result.author ? [`**Author:** ${result.author}`] : []),
		...(result.highlights?.length
			? [`**Highlights:**\n${result.highlights.map((highlight) => `- ${highlight}`).join("\n")}`]
			: []),
	].join("\n\n");
}

function isOptionalString(value: unknown): value is string | null | undefined {
	return value === undefined || value === null || typeof value === "string";
}

function parseSearchResponse(value: unknown): ExaSearchResponse {
	if (typeof value !== "object" || value === null || !("results" in value) || !Array.isArray(value.results))
		throw new Error("web_search received a malformed response.");
	const results = value.results.map((result) => {
		if (
			typeof result !== "object" ||
			result === null ||
			!("title" in result ? isOptionalString(result.title) : true) ||
			!("url" in result ? isOptionalString(result.url) : true) ||
			!("publishedDate" in result ? isOptionalString(result.publishedDate) : true) ||
			!("author" in result ? isOptionalString(result.author) : true) ||
			!("highlights" in result
				? result.highlights === null ||
					result.highlights === undefined ||
					(Array.isArray(result.highlights) &&
						result.highlights.every((highlight: unknown) => typeof highlight === "string"))
				: true)
		)
			throw new Error("web_search received a malformed response.");
		return result as ExaSearchResult;
	});
	if (results.length === 0) throw new Error("web_search returned no results.");
	return { results };
}

export function createWebSearchTool(
	dependencies: WebSearchDependencies = defaultDependencies(),
): ToolDefinition<any, any, any> {
	return {
		name: "web_search",
		label: "web_search",
		description:
			"Search the web for any topic and get clean, ready-to-use content. Best for finding current information, news, facts, people, companies, or answers. Describe the ideal page rather than using only keywords.",
		parameters: Type.Object({
			query: Type.String({
				minLength: 1,
				description: "Natural-language description of the ideal page, not just keywords.",
			}),
			numResults: Type.Optional(Type.Number({ description: "Number of search results to return (default: 10)." })),
		}),
		async execute(_id, params: { query: string; numResults?: number }, signal) {
			const query = params.query.trim();
			if (!query) throw new Error("web_search requires a non-empty query.");
			if (
				params.numResults !== undefined &&
				(!Number.isInteger(params.numResults) || params.numResults < 1 || params.numResults > 100)
			)
				throw new Error("web_search numResults must be an integer from 1 to 100.");
			const credential = dependencies.authStorage.get("exa");
			const apiKey = credential?.type === "api_key" ? credential.key : dependencies.env.EXA_API_KEY;
			if (!apiKey) throw new Error("web_search requires Exa credentials in Pi AuthStorage or EXA_API_KEY.");
			if (signal?.aborted) throw new Error("web_search was cancelled.");
			const request = new AbortController();
			let timedOut = false;
			const cancel = () => request.abort();
			signal?.addEventListener("abort", cancel, { once: true });
			const timeout = setTimeout(() => {
				timedOut = true;
				request.abort();
			}, 30_000);
			try {
				let response: Response;
				try {
					response = await dependencies.fetch("https://api.exa.ai/search", {
						method: "POST",
						headers: { "content-type": "application/json", "x-api-key": apiKey },
						body: JSON.stringify({
							query,
							type: "auto",
							numResults: params.numResults ?? 10,
							contents: { highlights: true },
						}),
						signal: request.signal,
					});
				} catch {
					if (timedOut) throw new Error("web_search timed out after 30 seconds.");
					if (signal?.aborted) throw new Error("web_search was cancelled.");
					throw new Error("web_search network request failed.");
				}
				if (!response.ok) {
					if (response.status === 401 || response.status === 403)
						throw new Error("web_search authentication failed.");
					if (response.status === 429) throw new Error("web_search rate limit exceeded.");
					throw new Error(`web_search Exa request failed (HTTP ${response.status}).`);
				}
				let value: unknown;
				try {
					value = await response.json();
				} catch {
					if (timedOut) throw new Error("web_search timed out after 30 seconds.");
					if (signal?.aborted) throw new Error("web_search was cancelled.");
					throw new Error("web_search received a malformed response.");
				}
				const body = parseSearchResponse(value);
				return {
					content: [{ type: "text", text: body.results.map(formatResult).join("\n\n") }],
					details: { resultCount: body.results.length },
				};
			} finally {
				clearTimeout(timeout);
				signal?.removeEventListener("abort", cancel);
			}
		},
	} as ToolDefinition<any, any, any>;
}
