/**
 * Pi Harness V2 — extension entry point.
 *
 * Wires all harness modules onto pi. Contract of record:
 * docs/pi-harness-v2-spec.md; build order: docs/pi-harness-v2-checklist.md.
 *
 * Modules are wired in as each phase lands.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerShellCommand } from "./shell/command.ts";
import { BackgroundShellRegistry } from "./shell/registry.ts";
import { registerShellStatus } from "./shell/status.ts";
import skillTool from "./skill/index.ts";

export default function harness(pi: ExtensionAPI) {
	// Per-session background-process registry (spec §3.3). status/cancel
	// tools read from the same instance when they land.
	const shellRegistry = new BackgroundShellRegistry();
	registerShellCommand(pi, shellRegistry);
	registerShellStatus(pi, shellRegistry);
	pi.on("session_shutdown", () => shellRegistry.killAll());

	skillTool(pi); // Phase 3 (§4.5)

	// Phase 1 (rest of slice): shell_command_cancel.
	// Later phases: apply_patch, modes, subagent runtime.
}
