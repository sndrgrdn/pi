/** Parallel engine adapter for `websearch` (ported from opencode's plugin/websearch/parallel.ts): `web_search` over the shared MCP client, key as Bearer header, `structuredContent` parsing. */

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

/** Parallel's MCP endpoint; the API key travels as a `Bearer` authorization header. */
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

/** One Parallel result as the JSON-RPC payload carries it, before SearchResult mapping. */
export interface ParallelResultItem {
  readonly url: string;
  readonly title?: string | null | undefined;
  readonly publish_date?: string | null | undefined;
  readonly excerpts: readonly string[];
}

/** Map Parallel's structured results to `SearchResult`; unparseable dates are dropped. */
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

/** Search Parallel via MCP; a missing result payload yields no results, malformed payloads fail `decode`. */
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
