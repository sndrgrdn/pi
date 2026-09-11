/**
 * Bash with automatic backgrounding: overrides `bash` (auto-background
 * after 30 s, or `background: true`), plus `bash_status` and `bash_cancel`.
 * All three share one registry; on `session_shutdown` and process exit
 * every still-running background process is killed, so no orphans survive.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Effect } from "effect";
import { Text } from "@earendil-works/pi-tui";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { emptyToolResult, toolErrorResult } from "../utils/tool-render.ts";
import { createBackgroundingBashDefinition } from "./command.ts";
import { createBackgroundProcesses, type BackgroundProcessesContract } from "./registry.ts";
import { createRealProcessSpawner } from "./process.ts";
import { bashStatusToolDefinition } from "./status.ts";

const bashCancelParameters = Type.Object({
  id: Type.Number({
    description: "Id (pid) of the background process to cancel.",
  }),
});

/** Creates a cancellation tool that kills the process group, including children. */
export function bashCancelToolDefinition(
  processes: BackgroundProcessesContract,
): ToolDefinition<typeof bashCancelParameters> {
  return defineTool({
    name: "bash_cancel",
    label: "bash_cancel",
    description: "Cancel a background process and its children by id (pid from bash_status).",
    parameters: bashCancelParameters,
    async execute(_toolCallId, params) {
      const entry = await Effect.runPromise(processes.kill(params.id));

      return {
        content: [
          { type: "text", text: `Cancelled background process ${entry.pid} (${entry.command}).` },
        ],
        details: undefined,
      };
    },
    renderCall(args, theme) {
      return new Text(theme.fg("toolTitle", `✗ Bash cancel ${args.id}`), 0, 0);
    },
    renderResult(result, _options, theme, context) {
      if (context.isError) return toolErrorResult(result, "✗", theme);

      return emptyToolResult();
    },
  });
}

/** Registers bash process tools and kills remaining background processes on shutdown. */
export default function bashBackground(pi: ExtensionAPI): void {
  const spawner = createRealProcessSpawner();
  const processes = createBackgroundProcesses(spawner);

  pi.on("session_start", (_event, ctx) => {
    pi.registerTool(createBackgroundingBashDefinition(ctx.cwd, { processes, spawner }));
    pi.registerTool(bashStatusToolDefinition(processes));
    pi.registerTool(bashCancelToolDefinition(processes));
  });

  const killAll = (): void => {
    Effect.runSync(processes.killAllBackgrounded());
  };

  pi.on("session_shutdown", killAll);
  process.once("exit", killAll);
}
