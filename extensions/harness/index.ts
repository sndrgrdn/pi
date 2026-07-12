/**
 * Pi Harness V2 — extension entry point.
 *
 * Wires all harness modules onto pi. Contract of record:
 * docs/pi-harness-v2-spec.md; build order: docs/pi-harness-v2-checklist.md.
 *
 * Modules are wired in as each phase lands.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerShellCancel } from "./shell/cancel.ts";
import { registerShellCommand } from "./shell/command.ts";
import { registerApplyPatch } from "./patch/tool.ts";
import { BackgroundShellRegistry } from "./shell/registry.ts";
import { currentShellRegistry } from "./shell/session-registry.ts";
import { registerShellStatus } from "./shell/status.ts";
import skillTool from "./skill/index.ts";
import { registerModes } from "./modes.ts";
import { registerFinder } from "./tools/finder.ts";

export default function harness(pi: ExtensionAPI) {
	// Per-session background-process registry (spec §3.3), shared by the
	// shell triplet (§9.2: indivisible).
	const shellRegistry = currentShellRegistry() ?? new BackgroundShellRegistry();
	registerShellCommand(pi, shellRegistry);
	registerShellStatus(pi, shellRegistry);
	registerShellCancel(pi, shellRegistry);
	pi.on("session_shutdown", () => shellRegistry.killAll());

	// Phase 2 (§4.4): apply_patch, the sole editor. Builtin edit/write stay
	// enabled until the Phase 10 surface lock.
	registerApplyPatch(pi);

	skillTool(pi); // Phase 3 (§4.5)

	// Phase 4 (§2): Modes + Profiles. Loads (and strictly validates)
	// ~/.pi/agent/profiles.json — an invalid file fails startup loudly.
	const profiles = registerModes(pi);

	registerFinder(pi, profiles); // Phase 6 (§6.2)
}
