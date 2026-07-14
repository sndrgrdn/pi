import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Value } from "typebox/value";
import {
	type CodedToolError,
	createCodedToolErrorFactory,
	createExaDependencies,
	type ExaDependencies,
	requestExaJson,
} from "./exa.ts";

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

type WebSearchFailureCode = "invalid_input" | "malformed_response" | "empty_results";
type WebSearchError = CodedToolError<WebSearchFailureCode>;

const failure: (code: WebSearchFailureCode, message: string) => WebSearchError =
	createCodedToolErrorFactory<WebSearchFailureCode>("web_search", "WebSearchError");

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

export function createWebSearchTool(dependencies: ExaDependencies = createExaDependencies()) {
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
			const outcome = await requestExaJson(
				"web_search",
				"search",
				{
					query: searchRequest.query,
					type: "auto",
					numResults: searchRequest.numResults,
					contents: { highlights: true },
				},
				dependencies,
				signal,
			);
			if (!outcome.ok) throw outcome.error;
			const results = parseSearchResponse(outcome.value);
			return {
				content: [{ type: "text", text: results.map(formatResult).join("\n\n") }],
				details: { resultCount: results.length },
			};
		},
	});
}
