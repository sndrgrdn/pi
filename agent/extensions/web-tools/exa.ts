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

export const EXA_ENDPOINT = "https://mcp.exa.ai/mcp";

const ExaOutput = Schema.Struct({
  content: Schema.Array(Schema.Struct({ type: Schema.Literal("text"), text: Schema.String })),
});

export function parseExaResults(text: string): SearchResult[] {
  return text.split(/\n\n---\n\n/).flatMap((block) => {
    const url = block.match(/^URL:\s*(.+)$/m)?.[1]?.trim();

    if (!url) return [];
    const title = block.match(/^Title:\s*(.+)$/m)?.[1]?.trim();
    const publishedText = block.match(/^Published:\s*(.+)$/m)?.[1]?.trim();

    const published =
      publishedText && publishedText !== "N/A" ? Date.parse(publishedText) : undefined;

    const content = block.match(/^(?:Highlights|Text):\s*\n?([\s\S]*)$/m)?.[1]?.trim();
    const extras: SearchResultExtras = {};

    if (title && title !== "N/A") extras.title = title;

    if (content !== undefined) extras.content = content;

    const result: SearchResult = {
      url,
      time: published !== undefined && Number.isFinite(published) ? { published } : {},
      ...extras,
    };

    return [result];
  });
}

const exaUrl = (key: string | undefined) => {
  const url = new URL(EXA_ENDPOINT);

  if (key) url.searchParams.set("exaApiKey", key);

  return url.toString();
};

const decodeExaOutput = Schema.decodeUnknownSync(ExaOutput);

export const exaSearch = Effect.fn("Exa.search")(function* (
  http: HttpFetchContract,
  query: string,
  key: string | undefined,
  signal: AbortSignal | undefined,
): Effect.fn.Return<SearchResult[], WebSearchError> {
  const result = yield* mcpCall({
    http,
    url: exaUrl(key),
    tool: "web_search_exa",
    body: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "web_search_exa", arguments: { query, numResults: 8 } },
    },
    signal,
    engine: "exa",
  });

  if (result === undefined) return [];

  return yield* Effect.try({
    try: () => {
      const output = decodeExaOutput(result);
      const content = output.content.find((item) => item.text);

      return content ? parseExaResults(content.text) : [];
    },
    catch: (error) =>
      createWebSearchError("decode", { engine: "exa", tool: "web_search_exa", cause: error }),
  });
});
