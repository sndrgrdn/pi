/**
 * `websearch` domain core: typed failures, engine/key resolution, strict
 * one-engine orchestration, result rendering. The typed error lives here so
 * the engine adapters can import it without an import cycle.
 */

import { readStoredCredential } from "@earendil-works/pi-coding-agent";
import { Effect } from "effect";
import * as Schema from "effect/Schema";
import { exaSearch } from "./exa.ts";
import { type HttpFetchContract } from "./http.ts";
import { parallelSearch } from "./parallel.ts";

/** The websearch backends pi ships; project/global settings select one, no failover. */
export type SearchEngine = "exa" | "parallel";

/** The engine used when settings do not name one. */
export const DEFAULT_ENGINE: SearchEngine = "exa";

/** Rendered when a search yields no results. */
export const NO_RESULTS = "No search results found. Please try a different query.";

/** One search hit: the URL, optional title/content, and optional publish timestamp. */
export interface SearchResult {
  readonly url: string;
  readonly title?: string;
  readonly content?: string;
  readonly time: { readonly published?: number };
}

/**
 * Mutable display fields collected during parsing. Spread into a SearchResult
 * after the guard clauses; the readonly contract stays on SearchResult.
 */
export interface SearchResultExtras {
  title?: string;
  content?: string;
}

/** Tool-result details the model sees for a completed search. */
export interface WebSearchDetails {
  readonly engine: SearchEngine;
  readonly results: readonly SearchResult[];
  readonly fullOutputPath?: string;
}

/** Typed search failures; each carries `message` with the engine/tool context and the fields needed to recover. */
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

/** Build a `WebSearchError` with the stable message its kind owns; fields carry engine/tool/cause context. */
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

/** Project settings override global; an unrecognized value is an error, not a silent fallback. */
const EngineSettings = Schema.Struct({
  websearch: Schema.optional(Schema.Struct({ engine: Schema.optional(Schema.String) })),
});

/** The settings shape `resolveEngine` reads; unknown custom keys are tolerated at decode time. */
export type EngineSettingsContract = Schema.Schema.Type<typeof EngineSettings>;

/** Decode raw settings (which may carry unknown custom keys) into the engine selector view. */
export const decodeEngineSettings = Schema.decodeUnknownOption(EngineSettings);

/** Resolve the engine from project-then-global settings; fails `invalidEngine` on an unrecognized value. */
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

/** Env var → stored credential → keyless. Injectable `env`/`authPath` so tests control credentials without a ConfigProvider. */
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

/** One websearch request: the query, the resolved engine, and the injectable test seams. */
export interface SearchInput {
  query: string;
  engine: SearchEngine;
  signal?: AbortSignal | undefined;
  /** Injectable for tests. */
  env?: (name: string) => string | undefined;
  /** Injectable for tests. */
  authPath?: string;
}

/** Strict: one engine, no failover. */
export const runWebSearch = Effect.fn("WebSearch.runWebSearch")(function* (
  http: HttpFetchContract,
  input: SearchInput,
): Effect.fn.Return<SearchResult[], WebSearchError> {
  const key = resolveEngineApiKey(input.engine, input.env, input.authPath);

  return input.engine === "exa"
    ? yield* exaSearch(http, input.query, key, input.signal)
    : yield* parallelSearch(http, input.query, key, input.signal);
});

/** Render results as model-facing markdown, or `NO_RESULTS` when there are none. */
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
