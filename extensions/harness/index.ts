/**
 * Pi Harness V2 — extension entry point.
 *
 * Wires all harness modules onto pi. Contract of record:
 * docs/pi-harness-v2-spec.md; build order: docs/pi-harness-v2-checklist.md.
 *
 * Modules are wired in as each phase lands.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import skillTool from "./skill/index.ts";

export default function harness(pi: ExtensionAPI) {
	skillTool(pi); // Phase 3 (§4.5)
	// Later phases: shell triplet, apply_patch, modes, subagent runtime.
}
