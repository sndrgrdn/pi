/**
 * `webfetch` + `websearch` as one extension (pi discovers `index.ts` one
 * level deep under `agent/extensions/` and calls its default export).
 * Shared infra: `http.ts`, `tool-output.ts`, `search.ts`, `mcp.ts`,
 * `exa.ts` / `parallel.ts`, `fetch-page.ts`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import webFetchOverride from "./webfetch.ts";
import webSearchOverride from "./websearch.ts";

/** Register `webfetch` and `websearch` as one extension; pi calls the default export with the ExtensionAPI. */
export default function webTools(pi: ExtensionAPI) {
  webFetchOverride(pi);
  webSearchOverride(pi);
}
