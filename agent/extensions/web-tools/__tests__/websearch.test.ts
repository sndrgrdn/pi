import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect, Exit } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXA_ENDPOINT, exaSearch, parseExaResults } from "../exa.ts";
import { PARALLEL_ENDPOINT, parallelSearch } from "../parallel.ts";
import type { HttpFetchContract } from "../http.ts";
import {
  NO_RESULTS,
  renderSearchResults,
  resolveEngine,
  resolveEngineApiKey,
  runWebSearch,
  type SearchResult,
} from "../search.ts";
import { findExitError } from "./find-exit-error.ts";

let dir: string;

let authPath: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "websearch-test-"));
  authPath = path.join(dir, "auth.json");
  await writeFile(
    authPath,
    JSON.stringify({ exa: { type: "api_key", key: "stored-key" } }),
    "utf8",
  );
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const noEnv = () => undefined;

/** A fake HTTP boundary that records requests and serves one canned response. */
/** JSON-RPC response payloads are JSON; the result field can hold any JSON value. */
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function fakeHttp(handler: (url: string, init: RequestInit) => Response): FakeHttpProbe {
  const requests: Array<{ url: string; init: RequestInit }> = [];

  return {
    http: {
      fetch: (url: string, init: RequestInit) => {
        requests.push({ url, init });

        return Promise.resolve(handler(url, init));
      },
    },
    requests,
  };
}

interface FakeHttpProbe {
  http: HttpFetchContract;
  requests: Array<{ url: string; init: RequestInit }>;
}

function jsonRpcResult(result: JsonValue): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
    headers: { "content-type": "application/json" },
  });
}

describe("engine selection", () => {
  it("defaults to exa", async () => {
    const exit = await resolveEngine({}, {}).pipe(Effect.exit, Effect.runPromise);
    expect(Exit.isSuccess(exit)).toBe(true);

    if (Exit.isSuccess(exit)) expect(exit.value).toBe("exa");
  });

  it("reads the global engine setting", async () => {
    const exit = await resolveEngine({ websearch: { engine: "parallel" } }, {}).pipe(
      Effect.exit,
      Effect.runPromise,
    );

    expect(Exit.isSuccess(exit)).toBe(true);

    if (Exit.isSuccess(exit)) expect(exit.value).toBe("parallel");
  });

  it("lets project settings override global settings", async () => {
    const exit = await resolveEngine(
      { websearch: { engine: "parallel" } },
      { websearch: { engine: "exa" } },
    ).pipe(Effect.exit, Effect.runPromise);

    expect(Exit.isSuccess(exit)).toBe(true);

    if (Exit.isSuccess(exit)) expect(exit.value).toBe("exa");
  });

  it("fails on an unrecognized engine instead of falling back", async () => {
    const exit = await resolveEngine({ websearch: { engine: "firecrawl" } }, {}).pipe(
      Effect.exit,
      Effect.runPromise,
    );

    expect(Exit.isFailure(exit)).toBe(true);
    const error = findExitError(exit);
    expect(error).toBeDefined();
    expect(error?.kind).toBe("invalidEngine");
  });
});

describe("key resolution", () => {
  it("prefers the engine env var over the stored credential", () => {
    const env = (name: string) => (name === "EXA_API_KEY" ? "env-key" : undefined);
    expect(resolveEngineApiKey("exa", env, authPath)).toBe("env-key");
  });

  it("falls back to the stored credential", () => {
    expect(resolveEngineApiKey("exa", noEnv, authPath)).toBe("stored-key");
  });

  it("stays keyless without any credential", () => {
    expect(resolveEngineApiKey("exa", noEnv, "/nonexistent/auth.json")).toBeUndefined();
  });

  it("uses the parallel env var name", () => {
    const env = (name: string) => (name === "PARALLEL_API_KEY" ? "p-key" : undefined);
    expect(resolveEngineApiKey("parallel", env)).toBe("p-key");
  });
});

describe("exa search", () => {
  it("calls web_search_exa with the JSON-RPC body and the key as a query param", async () => {
    const { http, requests } = fakeHttp(() =>
      jsonRpcResult({
        content: [
          {
            type: "text",
            text: "Title: Effect\nURL: https://effect.website\nHighlights:\nEffect documentation",
          },
        ],
      }),
    );

    const exit = await exaSearch(http, "effect typescript", "secret", undefined).pipe(
      Effect.exit,
      Effect.runPromise,
    );

    expect(Exit.isSuccess(exit)).toBe(true);

    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual([
        {
          url: "https://effect.website",
          title: "Effect",
          content: "Effect documentation",
          time: {},
        },
      ]);
    }

    expect(requests).toHaveLength(1);
    const request = requests[0];

    if (!request) throw new Error("test invariant: expected a recorded request");
    expect(request.url).toBe(`${EXA_ENDPOINT}?exaApiKey=secret`);
    expect(JSON.parse(String(request.init.body))).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "web_search_exa",
        arguments: { query: "effect typescript", numResults: 8 },
      },
    });
    expect(request.init.headers).toMatchObject({
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    });
  });

  it("tolerates data:-prefixed SSE lines", async () => {
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [
          {
            type: "text",
            text: "Title: Effect\nURL: https://effect.website\nHighlights:\nsse results",
          },
        ],
      },
    });

    const { http } = fakeHttp(() => new Response(`event: message\ndata: ${payload}\n\n`));

    const exit = await exaSearch(http, "effect", undefined, undefined).pipe(
      Effect.exit,
      Effect.runPromise,
    );

    expect(Exit.isSuccess(exit)).toBe(true);

    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual([
        { url: "https://effect.website", title: "Effect", content: "sse results", time: {} },
      ]);
    }
  });

  it("omits the key query param when keyless", async () => {
    const { http, requests } = fakeHttp(() =>
      jsonRpcResult({ content: [{ type: "text", text: "URL: https://effect.website" }] }),
    );

    const exit = await exaSearch(http, "effect", undefined, undefined).pipe(
      Effect.exit,
      Effect.runPromise,
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    const request = requests[0];

    if (!request) throw new Error("test invariant: expected a recorded request");
    expect(request.url).toBe(EXA_ENDPOINT);
  });
});

describe("parallel search", () => {
  it("calls web_search with the key in the authorization header", async () => {
    const { http, requests } = fakeHttp(() =>
      jsonRpcResult({
        content: [{ type: "text", text: "search results" }],
        structuredContent: {
          search_id: "search_1",
          results: [
            {
              url: "https://effect.website",
              title: "Effect",
              publish_date: null,
              excerpts: ["Effect documentation"],
            },
          ],
          warnings: null,
          usage: [{ name: "sku_search", count: 1 }],
          session_id: "ses_parallel",
        },
      }),
    );

    const exit = await parallelSearch(http, "effect layers", "parallel-secret", undefined).pipe(
      Effect.exit,
      Effect.runPromise,
    );

    expect(Exit.isSuccess(exit)).toBe(true);

    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual([
        {
          url: "https://effect.website",
          title: "Effect",
          content: "Effect documentation",
          time: {},
        },
      ]);
    }

    const request = requests[0];

    if (!request) throw new Error("test invariant: expected a recorded request");
    expect(request.url).toBe(PARALLEL_ENDPOINT);
    expect(request.init.headers).toMatchObject({ Authorization: "Bearer parallel-secret" });
    expect(JSON.parse(String(request.init.body))).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "web_search",
        arguments: { objective: "effect layers", search_queries: ["effect layers"] },
      },
    });
  });
});

describe("parseExaResults", () => {
  it("parses URL, title, published date and highlights", () => {
    const text = [
      "Title: Effect",
      "URL: https://effect.website",
      "Published: 2026-07-25T00:00:00.000Z",
      "Author: N/A",
      "Highlights:",
      "Effect documentation",
    ].join("\n");

    expect(parseExaResults(text)).toEqual([
      {
        url: "https://effect.website",
        title: "Effect",
        content: "Effect documentation",
        time: { published: Date.parse("2026-07-25T00:00:00.000Z") },
      },
    ]);
  });

  it("skips blocks without a URL and treats N/A fields as absent", () => {
    expect(parseExaResults("Title: Orphan\nHighlights:\nno url")).toEqual([]);
    expect(parseExaResults("URL: https://x.example\nTitle: N/A\nPublished: N/A")).toEqual([
      { url: "https://x.example", time: {} },
    ]);
  });
});

describe("renderSearchResults", () => {
  it("renders opencode-style markdown with the published date", () => {
    const results: SearchResult[] = [
      {
        url: "https://effect.website",
        title: "Effect",
        content: "Effect documentation",
        time: { published: Date.parse("2026-07-25T00:00:00.000Z") },
      },
    ];

    expect(renderSearchResults(results)).toBe(
      "## [Effect](https://effect.website)\nPublished: 2026-07-25T00:00:00.000Z\n\nEffect documentation",
    );
  });

  it("falls back to the URL when no title is present", () => {
    expect(renderSearchResults([{ url: "https://x.example", time: {} }])).toBe(
      "## [https://x.example](https://x.example)",
    );
  });
});

describe("runWebSearch", () => {
  it.each([
    ["exa", "web_search_exa"],
    ["parallel", "web_search"],
  ] as const)(
    "classifies %s tool errors without exposing search engine content",
    async (engine, tool) => {
      const engineText = "rate limited: private-query-and-credential";

      const { http, requests } = fakeHttp(() =>
        jsonRpcResult({
          isError: true,
          content: [{ type: "text", text: engineText }],
          structuredContent: { results: [] },
        }),
      );

      const exit = await runWebSearch(http, {
        query: "effect",
        engine,
        env: noEnv,
        authPath: "/nonexistent",
      }).pipe(Effect.exit, Effect.runPromise);

      expect(Exit.isFailure(exit)).toBe(true);
      const error = findExitError(exit);
      expect(error).toMatchObject({ kind: "engine", engine, tool });
      expect(error?.message).not.toContain(engineText);
      expect(error?.cause).toBeUndefined();
      expect(requests).toHaveLength(1);
    },
  );

  it.each(["exa", "parallel"] as const)("preserves successful empty %s results", async (engine) => {
    const { http } = fakeHttp(() =>
      jsonRpcResult({ isError: false, content: [], structuredContent: { results: [] } }),
    );

    const results = await runWebSearch(http, {
      query: "nothing",
      engine,
      env: noEnv,
      authPath: "/nonexistent",
    }).pipe(Effect.runPromise);

    expect(results).toEqual([]);
    expect(renderSearchResults(results)).toBe(NO_RESULTS);
  });

  it("classifies tool errors in SSE responses", async () => {
    const payload = JSON.stringify({ result: { isError: true, content: [] } });
    const { http } = fakeHttp(() => new Response(`event: message\ndata: ${payload}\n\n`));

    const exit = await runWebSearch(http, {
      query: "effect",
      engine: "exa",
      env: noEnv,
      authPath: "/nonexistent",
    }).pipe(Effect.exit, Effect.runPromise);

    expect(findExitError(exit)).toMatchObject({ kind: "engine", engine: "exa" });
  });

  it("returns no results for an empty response", async () => {
    const http = { fetch: () => Promise.resolve(jsonRpcResult({ content: [] })) };

    const exit = await runWebSearch(http, {
      query: "nothing",
      engine: "exa",
      env: noEnv,
      authPath: "/nonexistent",
    }).pipe(Effect.exit, Effect.runPromise);

    expect(Exit.isSuccess(exit)).toBe(true);

    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual([]);
      expect(renderSearchResults(exit.value)).toBe(NO_RESULTS);
    }
  });

  it("propagates a network failure instead of failing over", async () => {
    const http = {
      fetch: () => Promise.reject(new Error("connection refused")),
    };

    const exit = await runWebSearch(http, {
      query: "effect",
      engine: "parallel",
      env: noEnv,
      authPath: "/nonexistent",
    }).pipe(Effect.exit, Effect.runPromise);

    expect(Exit.isFailure(exit)).toBe(true);
    const error = findExitError(exit);
    expect(error).toBeDefined();
    expect(error?.kind).toBe("network");
    expect(error?.engine).toBe("parallel");
  });

  it("treats a missing result payload as no results", async () => {
    const http = { fetch: () => Promise.resolve(new Response("not json at all")) };

    const exit = await runWebSearch(http, {
      query: "nothing",
      engine: "exa",
      env: noEnv,
      authPath: "/nonexistent",
    }).pipe(Effect.exit, Effect.runPromise);

    expect(Exit.isSuccess(exit)).toBe(true);

    if (Exit.isSuccess(exit)) expect(renderSearchResults(exit.value)).toBe(NO_RESULTS);
  });

  it("fails on a malformed result payload", async () => {
    const http = { fetch: () => Promise.resolve(jsonRpcResult({ content: "not an array" })) };

    const exit = await runWebSearch(http, {
      query: "effect",
      engine: "exa",
      env: noEnv,
      authPath: "/nonexistent",
    }).pipe(Effect.exit, Effect.runPromise);

    expect(Exit.isFailure(exit)).toBe(true);
    const error = findExitError(exit);
    expect(error).toBeDefined();
    expect(error?.kind).toBe("decode");
  });
});
