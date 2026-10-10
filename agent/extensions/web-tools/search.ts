import { readStoredCredential } from "@earendil-works/pi-coding-agent";
import { Effect } from "effect";
import * as Schema from "effect/Schema";
import { exaSearch } from "./exa.ts";
import { type HttpFetchContract } from "./http.ts";
import { parallelSearch } from "./parallel.ts";

export type SearchEngine = "exa" | "parallel";

export const DEFAULT_ENGINE: SearchEngine = "exa";

export const NO_RESULTS = "No search results found. Please try a different query.";

export interface SearchResult {
  readonly url: string;
  readonly title?: string;
  readonly content?: string;
  readonly time: { readonly published?: number };
}

export interface SearchResultExtras {
  title?: string;
  content?: string;
}

export interface WebSearchDetails {
  readonly engine: SearchEngine;
  readonly results: readonly SearchResult[];
  readonly fullOutputPath?: string;
}

export class WebSearchError extends Schema.TaggedError<WebSearchError>()("WebSearch.Error", {
  kind: Schema.Union([
    Schema.Literal("invalidEngine"),
    Schema.Literal("network"),
    Schema.Literal("engine"),
    Schema.Literal("decode"),
    Schema.Literal("tooLarge"),
    Schema.Literal("timeout"),
  ]),
  engine: Schema.optionalKey(Schema.String),
  tool: Schema.optionalKey(Schema.String),
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Unknown),
}) {}

export const createWebSearchError = (
  kind: WebSearchError["kind"],
  fields: Partial<Omit<WebSearchError, "_tag" | "kind" | "message">> = {},
): WebSearchError => {
  const engine = fields.engine ?? "unknown";

  const message = (() => {
    switch (kind) {
      case "invalidEngine":
        return `Unknown websearch engine "${engine}". Use "exa" or "parallel" in settings.json.`;
      case "network":
        return `Web search failed: network error via ${engine}`;
      case "engine":
        return `Web search failed: search engine reported a tool error via ${engine}`;
      case "decode":
        return `Web search failed: response decode error via ${engine}`;
      case "tooLarge":
        return `Web search response too large (via ${engine})`;
      case "timeout":
        return `Web search timed out (via ${engine})`;
    }
  })();

  return new WebSearchError({ kind, ...fields, message });
};

const EngineSettings = Schema.Struct({
  websearch: Schema.optional(Schema.Struct({ engine: Schema.optional(Schema.String) })),
});

export type EngineSettingsContract = Schema.Schema.Type<typeof EngineSettings>;

export const decodeEngineSettings = Schema.decodeUnknownOption(EngineSettings);

export const resolveEngine = Effect.fn("WebSearch.resolveEngine")(function* (
  globalSettings: EngineSettingsContract | undefined,
  projectSettings: EngineSettingsContract | undefined,
): Effect.fn.Return<SearchEngine, WebSearchError> {
  const engineOf = (settings: EngineSettingsContract | undefined): string | undefined =>
    settings?.websearch?.engine;

  const raw = engineOf(projectSettings) ?? engineOf(globalSettings);

  if (raw === undefined) return DEFAULT_ENGINE;

  if (raw === "exa" || raw === "parallel") return raw;

  return yield* Effect.fail(createWebSearchError("invalidEngine", { engine: raw }));
});

export const resolveEngineApiKey = (
  engine: SearchEngine,
  env: (name: string) => string | undefined = (name) => process.env[name],
  authPath: string | undefined = undefined,
): string | undefined => {
  const envName = engine === "exa" ? "EXA_API_KEY" : "PARALLEL_API_KEY";
  const fromEnv = env(envName);

  if (fromEnv) return fromEnv;
  const stored = readStoredCredential(engine, authPath);

  return stored?.type === "api_key" && stored.key ? stored.key : undefined;
};

export interface SearchInput {
  query: string;
  engine: SearchEngine;
  signal?: AbortSignal | undefined;
  env?: (name: string) => string | undefined;
  authPath?: string;
}

export const runWebSearch = Effect.fn("WebSearch.runWebSearch")(function* (
  http: HttpFetchContract,
  input: SearchInput,
): Effect.fn.Return<SearchResult[], WebSearchError> {
  const key = resolveEngineApiKey(input.engine, input.env, input.authPath);

  return input.engine === "exa"
    ? yield* exaSearch(http, input.query, key, input.signal)
    : yield* parallelSearch(http, input.query, key, input.signal);
});

export function renderSearchResults(results: readonly SearchResult[]): string {
  if (results.length === 0) return NO_RESULTS;

  return results
    .map((result) => {
      const title = result.title ?? result.url;

      const published = result.time.published
        ? `\nPublished: ${new Date(result.time.published).toISOString()}`
        : "";

      return `## [${title}](${result.url})${published}${result.content ? `\n\n${result.content}` : ""}`;
    })
    .join("\n\n");
}
