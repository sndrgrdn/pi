/** Registration module of `webfetch` (ported from opencode V2): schema, execute bridge, rendering. Domain core in `fetch-page.ts`. */

import {
  type AgentToolResult,
  type AgentToolUpdateCallback,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  type ExtensionAPI,
  type ExtensionContext,
  formatSize,
} from "@earendil-works/pi-coding-agent";
import { Effect } from "effect";
import { type Static, Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import {
  fetchAndConvert,
  type FetchedPage,
  type FetchFormat,
  MAX_TIMEOUT_SECONDS,
} from "./fetch-page.ts";
import { parkTruncatedOutput } from "./tool-output.ts";
import { emptyToolResult, toolErrorResult, toolPreview } from "../utils/tool-render.ts";

/** The webfetch tool's parameter schema (typebox); `timeout` is capped at `MAX_TIMEOUT_SECONDS`. */
export const webFetchParameters = Type.Object({
  url: Type.String({ description: "The HTTP or HTTPS URL to fetch content from" }),
  format: Type.Optional(
    Type.Union([Type.Literal("text"), Type.Literal("markdown"), Type.Literal("html")], {
      default: "markdown",
      description: "The format to return the content in. Defaults to markdown.",
    }),
  ),
  timeout: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: MAX_TIMEOUT_SECONDS,
      description: `Optional timeout in seconds (maximum: ${MAX_TIMEOUT_SECONDS})`,
    }),
  ),
});

type WebFetchParams = Static<typeof webFetchParameters>;

/** Tool-result details the model sees for a successful fetch. */
export interface WebFetchDetails {
  url: string;
  contentType: string;
  format: FetchFormat;
  fullOutputPath?: string;
}

/** Throwing (not returning) is what marks the tool call isError. */
async function toAgentResult(page: FetchedPage): Promise<AgentToolResult<WebFetchDetails>> {
  const details: WebFetchDetails = {
    url: page.url,
    contentType: page.contentType,
    format: page.format,
  };

  const { text, fullOutputPath } = await parkTruncatedOutput(page.content, "pi-webfetch");

  if (fullOutputPath) details.fullOutputPath = fullOutputPath;

  return { content: [{ type: "text", text }], details };
}

/** Register the `webfetch` tool with pi; domain behavior lives in `fetch-page.ts`. */
export default function webFetchOverride(pi: ExtensionAPI) {
  pi.registerTool({
    name: "webfetch",
    label: "webfetch",
    description: `Fetch content from an HTTP or HTTPS URL and return it as text, markdown, or HTML (markdown default). For local files, use read instead. Large text results are truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}; the full output is parked in a temp file whose path is reported.`,
    promptSnippet: "Fetch a URL and return it as text, markdown, or HTML",
    promptGuidelines: [
      "Follow up a redirect response with a new webfetch request to the returned URL.",
    ],
    parameters: webFetchParameters,
    renderCall(args, theme) {
      let text = theme.fg("toolTitle", "% Web fetch ");
      text += theme.fg("accent", args.url);

      if (args.format && args.format !== "markdown") {
        text += theme.fg("dim", ` (${args.format})`);
      }

      if (args.timeout) {
        text += theme.fg("dim", ` (timeout: ${args.timeout}s)`);
      }

      return new Text(text, 0, 0);
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      if (isPartial) return new Text(theme.fg("warning", "% Fetching…"), 0, 0);

      if (context.isError) return toolErrorResult(result, "%", theme);

      if (!expanded) return emptyToolResult();
      const details = result.details;

      return toolPreview(result, theme, { fullOutputPath: details.fullOutputPath });
    },
    async execute(
      _toolCallId: string,
      params: WebFetchParams,
      signal: AbortSignal | undefined,
      _onUpdate: AgentToolUpdateCallback<WebFetchDetails> | undefined,
      _execCtx: ExtensionContext,
    ): Promise<AgentToolResult<WebFetchDetails>> {
      try {
        const page = await fetchAndConvert(
          { fetch: (input, init) => fetch(input, init) },
          {
            url: params.url,
            format: params.format,
            timeout: params.timeout,
            signal,
          },
        ).pipe(Effect.runPromise);

        return await toAgentResult(page);
      } catch (err) {
        // Throwing (not returning) is what marks the tool call isError.
        const message = err instanceof Error ? err.message : "Fetch failed.";
        throw new Error(message);
      }
    },
  });
}
