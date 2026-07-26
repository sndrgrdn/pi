/**
 * Agent extension entry point.
 *
 * Wires all harness modules onto pi.
 */
import { join } from "node:path";
import { type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";
import { registerApplyPatch } from "./patch/tool.ts";
import { loadProfiles } from "./profiles.ts";
import { isSubagentAbortError, SubagentRunner } from "./runner.ts";
import { registerShellCancel } from "./shell/cancel.ts";
import { registerShellCommand } from "./shell/command.ts";
import { BackgroundShellRegistry } from "./shell/registry.ts";
import { currentShellRegistry } from "./shell/session-registry.ts";
import { registerShellStatus } from "./shell/status.ts";
import { createCodeReviewTool } from "./tools/code-review.ts";
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
	"finder",
	"oracle",
	"librarian",
	"task",
	"code_review",
	"mcp",
] as const;

export default function harness(pi: ExtensionAPI) {
	const traceTools = createTraceToolRegistrar(
		pi,
		(error, signal) => signal?.aborted === true || isSubagentAbortError(error),
	);
	// Per-session background-process registry shared by the shell triplet.
	const shellRegistry = currentShellRegistry() ?? new BackgroundShellRegistry();
	registerShellCommand(pi, shellRegistry, traceTools.register);
	registerShellStatus(pi, shellRegistry, traceTools.register);
	registerShellCancel(pi, shellRegistry, traceTools.register);
	pi.on("session_shutdown", () => shellRegistry.killAll());

	// apply_patch is the sole editor. Builtin edit/write stay enabled until
	// the surface lock below.
	registerApplyPatch(pi, traceTools.register);
	registerRead(pi, traceTools.register);

	// Load profiles once at startup; invalid external configuration fails loudly.
	const profiles = loadProfiles(join(getAgentDir(), "profiles.json"));
	const runner = new SubagentRunner();
	traceTools.register(createFinderTool(runner, profiles));
	traceTools.register(createLibrarianTool(runner, profiles));
	traceTools.register(createOracleTool(runner, profiles));
	traceTools.register(createTaskTool(runner, profiles));
	traceTools.register(createCodeReviewTool(runner, profiles));

	// Action methods become available only after pi binds the extension runtime.
	// Lock every started/reloaded session at that seam.
	pi.on("session_start", () => pi.setActiveTools([...MAIN_TOOL_NAMES]));
}
