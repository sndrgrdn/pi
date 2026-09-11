/** Parallel MCP adapter for websearch. */

import { Effect } from "effect";
import * as Schema from "effect/Schema";
import type { HttpFetchContract } from "./http.ts";
import { mcpCall } from "./mcp.ts";
import {
  createWebSearchError,
  type SearchResult,
  type SearchResultExtras,
  type WebSearchError,
} from "./search.ts";

/** Parallel MCP endpoint. */
export const PARALLEL_ENDPOINT = "https://search.parallel.ai/mcp";

const ParallelOutput = Schema.Struct({
  content: Schema.Array(Schema.Struct({ type: Schema.Literal("text"), text: Schema.String })),
  structuredContent: Schema.Struct({
    results: Schema.Array(
      Schema.Struct({
        url: Schema.String,
        title: Schema.optional(Schema.NullOr(Schema.String)),
        publish_date: Schema.optional(Schema.NullOr(Schema.String)),
        excerpts: Schema.Array(Schema.String),
      }),
    ),
  }),
});

/** Parallel result payload before normalization. */
export interface ParallelResultItem {
  readonly url: string;
  readonly title?: string | null | undefined;
  readonly publish_date?: string | null | undefined;
  readonly excerpts: readonly string[];
}

/** Normalizes Parallel results and drops unparseable dates. */
export function parseParallelResults(output: {
  structuredContent: { results: readonly ParallelResultItem[] };
}): SearchResult[] {
  return output.structuredContent.results.map((item) => {
    const published = item.publish_date ? Date.parse(item.publish_date) : undefined;
    const extras: SearchResultExtras = {};

    if (item.title !== undefined && item.title !== null) extras.title = item.title;

    if (item.excerpts.length) extras.content = item.excerpts.join("\n\n");

    const result: SearchResult = {
      url: item.url,
      time: published !== undefined && Number.isFinite(published) ? { published } : {},
      ...extras,
    };

    return result;
  });
}

const decodeParallelOutput = Schema.decodeUnknownSync(ParallelOutput);

/** Searches Parallel; absent results are empty and malformed results fail decoding. */
export const parallelSearch = Effect.fn("Parallel.search")(function* (
  http: HttpFetchContract,
  query: string,
  key: string | undefined,
  signal: AbortSignal | undefined,
): Effect.fn.Return<SearchResult[], WebSearchError> {
  const result = yield* mcpCall({
    http,
    url: PARALLEL_ENDPOINT,
    tool: "web_search",
    body: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "web_search", arguments: { objective: query, search_queries: [query] } },
    },
    headers: key ? { Authorization: `Bearer ${key}` } : {},
    signal,
    engine: "parallel",
  });

  if (result === undefined) return [];

  return yield* Effect.try({
    try: () => parseParallelResults(decodeParallelOutput(result)),
    catch: (error) =>
      createWebSearchError("decode", { engine: "parallel", tool: "web_search", cause: error }),
  });
});
