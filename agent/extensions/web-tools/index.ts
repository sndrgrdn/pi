import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import webFetchOverride from "./webfetch.ts";
import webSearchOverride from "./websearch.ts";

export default function webTools(pi: ExtensionAPI) {
  webFetchOverride(pi);
  webSearchOverride(pi);
}
