/** Shared bounded and timed MCP tools/call client for websearch engines. */

import { Duration, Effect } from "effect";
import * as Schema from "effect/Schema";
import { collectBoundedBody, type HttpFetchContract } from "./http.ts";
import { createWebSearchError, type SearchEngine, type WebSearchError } from "./search.ts";

/** Maximum MCP response size in bytes. */
export const MCP_MAX_RESPONSE_BYTES = 256 * 1024;

/** MCP call timeout in seconds. */
export const MCP_TIMEOUT_SECONDS = 25;

/** MCP call input with engine and tool failure attribution. */
export interface McpCallInput {
  http: HttpFetchContract;
  url: string;
  tool: string;
  body: McpRequestBody;
  headers?: Record<string, string>;
  signal?: AbortSignal | undefined;
  engine: SearchEngine;
}

/** JSON-RPC tools/call request body. */
export interface McpRequestBody {
  jsonrpc: string;
  id: number;
  method: string;
  params: {
    name: string;
    arguments: Record<string, string | number | string[]>;
  };
}

/** Validated MCP result value. */
export type McpResult = Schema.Json;

/** Parses a JSON-RPC result or returns undefined for an absent result payload. */
export const parseMcpResponse = Effect.fn("MCP.parseResponse")(function* (
  body: string,
): Effect.fn.Return<McpResult | undefined, WebSearchError> {
  const decodeEnvelope = Schema.decodeUnknownSync(
    Schema.fromJsonString(Schema.Struct({ result: Schema.optionalKey(Schema.Json) })),
  );

  const parse = (payload: string): McpResult | undefined => {
    const trimmed = payload.trim();

    if (!trimmed.startsWith("{")) return undefined;

    return decodeEnvelope(trimmed).result;
  };

  return yield* Effect.try({
    try: () => {
      const trimmed = body.trim();
      const direct = trimmed ? parse(trimmed) : undefined;

      if (direct !== undefined) return direct;

      for (const line of body.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const data = parse(line.substring(6));

        if (data !== undefined) return data;
      }

      return undefined;
    },
    catch: (error) => createWebSearchError("decode", { cause: error }),
  });
});

const isMcpToolError = Schema.is(Schema.Struct({ isError: Schema.Literal(true) }));

/** Calls one MCP tool and rejects explicit tool errors before engine parsing. */
export const mcpCall = Effect.fn("MCP.call")(function* (
  input: McpCallInput,
): Effect.fn.Return<McpResult | undefined, WebSearchError> {
  const { http, url, tool, body, headers, signal, engine } = input;

  return yield* Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () =>
        http.fetch(url, {
          method: "POST",
          headers: {
            Accept: "application/json, text/event-stream",
            "Content-Type": "application/json",
            ...headers,
          },
          body: JSON.stringify(body),
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(MCP_TIMEOUT_SECONDS * 1000)])
            : AbortSignal.timeout(MCP_TIMEOUT_SECONDS * 1000),
        }),
      catch: (error) => createWebSearchError("network", { engine, tool, cause: error }),
    });

    if (!response.ok) return yield* Effect.fail(createWebSearchError("network", { engine, tool }));

    const bytes = yield* collectBoundedBody(
      response,
      MCP_MAX_RESPONSE_BYTES,
      () => createWebSearchError("tooLarge", { engine, tool }),
      (error) => createWebSearchError("network", { engine, tool, cause: error }),
    );

    const result = yield* parseMcpResponse(new TextDecoder().decode(bytes)).pipe(
      Effect.mapError((error) =>
        error.kind === "decode"
          ? createWebSearchError("decode", { engine, tool, cause: error.cause })
          : error,
      ),
    );

    if (isMcpToolError(result)) {
      // Search engine content can contain credentials or query data; retain only safe attribution.
      return yield* Effect.fail(createWebSearchError("engine", { engine, tool }));
    }

    return result;
  }).pipe(
    Effect.timeoutOrElse({
      duration: Duration.seconds(MCP_TIMEOUT_SECONDS),
      orElse: () => Effect.fail(createWebSearchError("timeout", { engine, tool })),
    }),
  );
});
