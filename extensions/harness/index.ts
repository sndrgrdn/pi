/**
 * Pi Harness V2 — extension entry point.
 *
 * Wires all harness modules onto pi. Contract of record:
 * docs/pi-harness-v2-spec.md; build order: docs/pi-harness-v2-checklist.md.
 *
 * Phase 0: empty scaffold. Modules are wired in as each phase lands.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function harness(_pi: ExtensionAPI) {
	// Phase 1+: shell triplet, apply_patch, skill, modes, subagent runtime.
}
