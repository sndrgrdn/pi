import { defineTool } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import { createExaDependencies, type ExaDependencies, requestExaJson } from "./exa.ts";

type WebFetchFailureCode = "invalid_input" | "malformed_response" | "empty_results";

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
const successStatus = Type.Object({
	id: Type.String({ minLength: 1 }),
	status: Type.Literal("success"),
});
const errorStatus = Type.Object({
	id: Type.String({ minLength: 1 }),
	status: Type.Literal("error"),
	error: Type.Object({
		tag: Type.String({ minLength: 1 }),
		httpStatusCode: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
	}),
});
type ExaErrorStatus = Static<typeof errorStatus>;
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
	statuses: Type.Array(Type.Union([successStatus, errorStatus])),
});

interface WebFetchRequest {
	urls: string[];
	maxCharacters: number;
}

interface WebFetchPage {
	title?: string;
	url: string;
	publishedDate?: string;
	author?: string;
	text: string;
}

interface WebFetchFailure {
	url: string;
	reason: string;
}

interface WebFetchResult {
	pages: WebFetchPage[];
	failures: WebFetchFailure[];
}

function formatPage(page: WebFetchPage): string {
	return [
		`# ${page.title || "(no title)"}`,
		`URL: ${page.url}`,
		...(page.publishedDate ? [`Published: ${page.publishedDate.split("T")[0]}`] : []),
		...(page.author ? [`Author: ${page.author}`] : []),
		"",
		page.text,
	].join("\n");
}

function formatFailure(failed: WebFetchFailure): string {
	return `Error fetching ${failed.url}: ${failed.reason}`;
}

function failure(code: WebFetchFailureCode, message: string): WebFetchError {
	return new WebFetchError(code, `web_fetch ${message}`);
}

function parseFetchResponse(value: unknown): WebFetchResult {
	if (!Value.Check(exaResponse, value)) throw failure("malformed_response", "received a malformed response.");
	return {
		pages: value.results.map((page) => ({
			...(page.title ? { title: page.title } : {}),
			url: page.url,
			...(page.publishedDate ? { publishedDate: page.publishedDate } : {}),
			...(page.author ? { author: page.author } : {}),
			text: page.text,
		})),
		failures: value.statuses
			.filter((status): status is ExaErrorStatus => status.status === "error")
			.map((status) => ({ url: status.id, reason: status.error.tag })),
	};
}

export function createWebFetchTool(dependencies: ExaDependencies = createExaDependencies()) {
	return defineTool({
		name: "web_fetch",
		label: "web_fetch",
		description:
			"Read a webpage's full content as clean markdown. Use after web_search when highlights are insufficient or to read any URL.\n\nBest for: Extracting full content from known URLs. Batch multiple URLs in one call.\nReturns: Clean text content and metadata from the page(s).",
		parameters,
		async execute(_id, params, signal) {
			if (!Value.Check(parameters, params))
				throw failure("invalid_input", "requires a non-empty urls array and a positive maxCharacters.");
			const fetchRequest: WebFetchRequest = {
				urls: [...params.urls],
				maxCharacters: params.maxCharacters ?? 3000,
			};
			const outcome = await requestExaJson(
				"web_fetch",
				"contents",
				{ urls: fetchRequest.urls, text: { maxCharacters: fetchRequest.maxCharacters } },
				dependencies,
				signal,
			);
			if (!outcome.ok) throw outcome.error;
			const result = parseFetchResponse(outcome.value);
			if (result.pages.length === 0) {
				const reasons = result.failures.map((failed) => `${failed.url}: ${failed.reason}`).join("; ");
				throw failure("empty_results", reasons ? `failed to fetch every URL: ${reasons}.` : "returned no content.");
			}
			return {
				content: [
					{
						type: "text",
						text: [...result.pages.map(formatPage), ...result.failures.map(formatFailure)].join("\n\n"),
					},
				],
				details: { resultCount: result.pages.length },
			};
		},
	});
}
