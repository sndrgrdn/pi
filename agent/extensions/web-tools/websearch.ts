/**
 * Registration module of `websearch` (ported from opencode V2): schema,
 * settings-aware engine selection, execute bridge, rendering. Domain core
 * in `search.ts`; engine adapters in `exa.ts` / `parallel.ts`.
 */

import {
  type AgentToolResult,
  type AgentToolUpdateCallback,
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Effect, Option } from "effect";
import { type Static, Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import { parkTruncatedOutput } from "./tool-output.ts";
import { emptyToolResult, toolErrorResult, toolPreview } from "../utils/tool-render.ts";
import {
  renderSearchResults,
  resolveEngine,
  runWebSearch,
  decodeEngineSettings,
  type WebSearchDetails,
  WebSearchError,
} from "./search.ts";

const webSearchParameters = Type.Object({
  query: Type.String({ description: "Websearch query" }),
});

type WebSearchParams = Static<typeof webSearchParameters>;

/** Register the `websearch` tool with pi; domain behavior lives in `search.ts`, engine adapters in `exa.ts`/`parallel.ts`. */
export default function webSearchOverride(pi: ExtensionAPI) {
  pi.registerTool({
    name: "websearch",
    label: "websearch",
    description: `Search the web for up-to-date information, especially beyond your knowledge cutoff. The current year is ${new Date().getFullYear()}; use it when searching for recent information or current events.`,
    promptSnippet: "Search the web for up-to-date information",
    promptGuidelines: [
      "Use websearch for discovery (what exists?); use webfetch for the content of one specific URL.",
    ],
    parameters: webSearchParameters,
    renderCall(args, theme) {
      // The engine is resolved inside execute, so the start line uses the fallback label.
      let text = theme.fg("toolTitle", "◈ Web search ");
      text += theme.fg("accent", `"${args.query}"`);

      return new Text(text, 0, 0);
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      if (isPartial) return new Text(theme.fg("warning", "◈ Searching…"), 0, 0);

      if (context.isError) return toolErrorResult(result, "◈", theme);

      if (!expanded) return emptyToolResult();
      const details = result.details;

      return toolPreview(result, theme, { fullOutputPath: details.fullOutputPath });
    },
    async execute(
      _toolCallId: string,
      params: WebSearchParams,
      signal: AbortSignal | undefined,
      _onUpdate: AgentToolUpdateCallback<WebSearchDetails> | undefined,
      execCtx: ExtensionContext,
    ): Promise<AgentToolResult<WebSearchDetails>> {
      try {
        const manager = SettingsManager.create(execCtx.cwd, getAgentDir(), {
          projectTrusted: execCtx.isProjectTrusted(),
        });

        const engine = await resolveEngine(
          Option.getOrUndefined(decodeEngineSettings(manager.getGlobalSettings())),
          Option.getOrUndefined(decodeEngineSettings(manager.getProjectSettings())),
        ).pipe(Effect.runPromise);

        const results = await runWebSearch(
          { fetch: (input, init) => fetch(input, init) },
          { query: params.query, engine, signal },
        ).pipe(Effect.runPromise);

        /** Optional full-output path, assigned when truncation parked the text. */
        interface WebSearchDetailsExtras {
          fullOutputPath?: string;
        }

        const { text, fullOutputPath } = await parkTruncatedOutput(
          renderSearchResults(results),
          "pi-websearch",
        );

        const detailsExtras: WebSearchDetailsExtras = {};

        if (fullOutputPath !== undefined) detailsExtras.fullOutputPath = fullOutputPath;
        const details: WebSearchDetails = { engine, results, ...detailsExtras };

        return { content: [{ type: "text", text }], details };
      } catch (err) {
        // Search failures carry their own stable message with engine context; other errors stay generic.
        if (err instanceof WebSearchError) throw new Error(err.message);
        throw new Error(`Unable to search the web for ${params.query}`);
      }
    },
  });
}
