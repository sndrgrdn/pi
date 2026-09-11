/** Registers webfetch and websearch from Pi's one-level extension discovery entrypoint. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import webFetchOverride from "./webfetch.ts";
import webSearchOverride from "./websearch.ts";

/** Registers both web tools. */
export default function webTools(pi: ExtensionAPI) {
  webFetchOverride(pi);
  webSearchOverride(pi);
}
