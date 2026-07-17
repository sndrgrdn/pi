import { defineTool } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import { createCodedToolErrorFactory, createExaDependencies, type ExaDependencies, requestExaJson } from "./exa.ts";

type WebFetchFailureCode = "invalid_input" | "malformed_response" | "empty_results";
const failure = createCodedToolErrorFactory<WebFetchFailureCode>("web_fetch", "WebFetchError");

const parameters = Type.Object(
	{
		urls: Type.Array(Type.String(), {
			minItems: 1,
			description: "Absolute HTTP or HTTPS URLs to fetch. Batch independent URLs in one call.",
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
	error: Type.Optional(
		Type.Object({
			tag: Type.Optional(Type.String({ minLength: 1 })),
			httpStatusCode: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
		}),
	),
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
	urls: URL[];
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

function parseUrls(urls: string[]): URL[] {
	const parsed: URL[] = [];
	for (const [index, input] of urls.entries()) {
		if (input.trim().length === 0)
			throw failure("invalid_input", `urls[${index}] is empty. Provide an absolute HTTP or HTTPS URL.`);

		let url: URL;
		try {
			url = new URL(input);
		} catch {
			throw failure("invalid_input", `urls[${index}] is malformed. Provide an absolute HTTP or HTTPS URL.`);
		}
		if (url.protocol !== "http:" && url.protocol !== "https:")
			throw failure(
				"invalid_input",
				`urls[${index}] uses unsupported scheme ${JSON.stringify(url.protocol)}. Only HTTP and HTTPS URLs are supported.`,
			);
		parsed.push(url);
	}
	return parsed;
}

function parseFetchResponse(value: unknown): WebFetchResult {
	if (!Value.Check(exaResponse, value)) throw failure("malformed_response", "received a malformed response.");
	const pages: WebFetchPage[] = [];
	const emptyPageFailures: WebFetchFailure[] = [];
	for (const page of value.results) {
		if (page.text.trim().length === 0) {
			emptyPageFailures.push({ url: page.url, reason: "empty content" });
			continue;
		}
		pages.push({
			...(page.title ? { title: page.title } : {}),
			url: page.url,
			...(page.publishedDate ? { publishedDate: page.publishedDate } : {}),
			...(page.author ? { author: page.author } : {}),
			text: page.text,
		});
	}
	return {
		pages,
		failures: [
			...value.statuses
				.filter((status): status is ExaErrorStatus => status.status === "error")
				.map((status) => ({ url: status.id, reason: status.error?.tag ?? "unknown error" })),
			...emptyPageFailures,
		],
	};
}

export function createWebFetchTool(dependencies: ExaDependencies = createExaDependencies()) {
	return defineTool({
		name: "web_fetch",
		label: "web_fetch",
		description:
			"Fetch Markdown content and metadata from known webpages. Use after web_search when its excerpts are insufficient.",
		parameters,
		async execute(_id, params, signal) {
			if (!Value.Check(parameters, params))
				throw failure("invalid_input", "requires a non-empty urls array and a positive maxCharacters.");
			const fetchRequest: WebFetchRequest = {
				urls: parseUrls(params.urls),
				maxCharacters: params.maxCharacters ?? 3000,
			};
			const outcome = await requestExaJson(
				"web_fetch",
				"contents",
				{
					urls: fetchRequest.urls.map((url) => url.href),
					text: { maxCharacters: fetchRequest.maxCharacters },
				},
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
