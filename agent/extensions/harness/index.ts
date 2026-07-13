/**
 * Pi Harness V2 — extension entry point.
 *
 * Wires all harness modules onto pi. Contract of record:
 * docs/pi-harness-v2-spec.md; build order: docs/pi-harness-v2-checklist.md.
 *
 * Modules are wired in as each phase lands.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerModes } from "./modes.ts";
import { registerApplyPatch } from "./patch/tool.ts";
import { isSubagentAbortError, SubagentRunner } from "./runner.ts";
import { registerShellCancel } from "./shell/cancel.ts";
import { registerShellCommand } from "./shell/command.ts";
import { BackgroundShellRegistry } from "./shell/registry.ts";
import { currentShellRegistry } from "./shell/session-registry.ts";
import { registerShellStatus } from "./shell/status.ts";
import skillTool from "./skill/index.ts";
import { createFinderTool } from "./tools/finder.ts";
import { createLibrarianTool } from "./tools/librarian.ts";
import { createOracleTool } from "./tools/oracle.ts";
import registerRead from "./tools/read.ts";
import { createTaskTool } from "./tools/task.ts";
import { createTraceToolRegistrar } from "./ui/trace.ts";

export const MAIN_TOOL_NAMES = [
	"shell_command",
	"shell_command_status",
	"shell_command_cancel",
	"read",
	"apply_patch",
	"skill",
	"finder",
	"oracle",
	"librarian",
	"task",
	"mcp",
] as const;

export default function harness(pi: ExtensionAPI) {
	const traceTools = createTraceToolRegistrar(
		pi,
		(error, signal) => signal?.aborted === true || isSubagentAbortError(error),
	);
	// Per-session background-process registry (spec §3.3), shared by the
	// shell triplet (§9.2: indivisible).
	const shellRegistry = currentShellRegistry() ?? new BackgroundShellRegistry();
	registerShellCommand(pi, shellRegistry, traceTools.register);
	registerShellStatus(pi, shellRegistry, traceTools.register);
	registerShellCancel(pi, shellRegistry, traceTools.register);
	pi.on("session_shutdown", () => shellRegistry.killAll());

	// Phase 2 (§4.4): apply_patch, the sole editor. Builtin edit/write stay
	// enabled until the Phase 10 surface lock.
	registerApplyPatch(pi, traceTools.register);
	registerRead(pi, traceTools.register);

	skillTool(pi, traceTools.register); // Phase 3 (§4.5)

	// Phase 4 (§2): Modes + Profiles. Loads (and strictly validates)
	// ~/.pi/agent/profiles.json — an invalid file fails startup loudly.
	const modes = registerModes(pi);
	const { profiles } = modes;
	const runner = new SubagentRunner();
	traceTools.register(createFinderTool(runner, profiles)); // Phase 6 (§6.2)
	traceTools.register(createLibrarianTool(runner, profiles)); // Phase 7 (§6.4)
	traceTools.register(createOracleTool(runner, profiles, modes.activeMode)); // Phase 8 (§6.3)
	traceTools.register(createTaskTool(runner, profiles)); // Phase 9 (§6.5)

	// Phase 10 (§4): action methods become available only after pi binds the
	// extension runtime. Lock every started/reloaded session at that seam.
	pi.on("session_start", () => pi.setActiveTools([...MAIN_TOOL_NAMES]));
}
