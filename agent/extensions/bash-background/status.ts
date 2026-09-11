/** Waiting observes without stopping: `bash_cancel` preempts it, an abort ends it, and the bound never kills anything. */

import { Effect } from "effect";
import { Text } from "@earendil-works/pi-tui";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { emptyToolResult, toolErrorResult, toolPreview } from "../utils/tool-render.ts";
import { BashError, bashError, toErrorString } from "./errors.ts";
import {
  ProcessState,
  type BackgroundProcess,
  type BackgroundProcessesContract,
} from "./registry.ts";
import type { OutputSnapshot } from "./shell-output-file.ts";

/** Character limit for status output tails. */
export const STATUS_OUTPUT_TAIL_CHARS = 2000;

/** Input schema for listing or waiting on background processes. */
export const bashStatusParameters = Type.Object({
  id: Type.Optional(
    Type.Number({
      description: "Id (pid) of a background process to inspect; omit to list them all.",
    }),
  ),
  wait_seconds: Type.Optional(
    Type.Number({
      description:
        "Wait up to this many seconds for the process to complete, then return its state and output. 0 or omitted returns an instant snapshot. The wait only observes; bash_cancel preempts it.",
    }),
  ),
});

/** Formats milliseconds as decimal seconds. */
export function formatElapsed(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatProcessState(state: ProcessState): string {
  return ProcessState.$match(state, {
    running: () => "running",
    completed: ({ exitCode }) =>
      exitCode === null ? "exited (signal)" : `completed (exit ${exitCode})`,
    cancelled: () => "cancelled",
  });
}

/** Formats one process for the status list. */
export function formatProcessLine(entry: BackgroundProcess, now = Date.now()): string {
  const state = formatProcessState(entry.state);

  return `- id ${entry.pid} · ${state} · ${formatElapsed(now - entry.startedAt)} · \`${entry.command}\``;
}

/** Formats the background-process list. */
export function formatProcessList(entries: BackgroundProcess[], now = Date.now()): string {
  if (entries.length === 0) return "No background processes.";

  return ["Background processes:", ...entries.map((entry) => formatProcessLine(entry, now))].join(
    "\n",
  );
}

/** Formats process state and output locations for status details. */
export function formatProcessDetail(entry: BackgroundProcess, snapshot: OutputSnapshot): string {
  const lines = [formatProcessLine(entry), `Working directory: ${entry.cwd}`];

  if (entry.finishedAt !== undefined) {
    lines.push(`Finished: ${new Date(entry.finishedAt).toISOString()}`);
  }

  const tail = snapshot.tail.slice(-STATUS_OUTPUT_TAIL_CHARS);
  const hidden = snapshot.tail.length - tail.length;
  lines.push("", "Output:", "```text", tail || "(no output yet)", "```");

  if (hidden > 0) {
    lines.push(
      `(showing the last ${tail.length} characters of ${snapshot.totalBytes} bytes produced)`,
    );
  }

  lines.push(`Full output: ${snapshot.fullPath}`);

  return lines.join("\n");
}

const abortStatusWait = (signal: AbortSignal): Effect.Effect<never, BashError> =>
  Effect.tryPromise({
    try: () =>
      new Promise<never>((_resolve, reject) => {
        if (signal.aborted) reject(bashError("aborted"));
        else signal.addEventListener("abort", () => reject(bashError("aborted")), { once: true });
      }),
    catch: (cause) =>
      cause instanceof BashError ? cause : bashError("aborted", { cause: toErrorString(cause) }),
  });

const waitForProcess = (
  processes: BackgroundProcessesContract,
  id: number,
  waitSeconds: number | undefined,
  signal: AbortSignal | undefined,
): Effect.Effect<BackgroundProcess, BashError> => {
  const wait = processes.waitForCompletion(id, waitSeconds ?? 0);

  if (!signal) return wait;

  return Effect.raceFirst(wait, abortStatusWait(signal));
};

/** Render state retained across status-tool renders. */
interface StatusWaitRenderState {
  startedAt?: number;
  interval: ReturnType<typeof setInterval> | undefined;
}

/** Creates the bash_status tool definition. */
export function bashStatusToolDefinition(
  processes: BackgroundProcessesContract,
): ToolDefinition<typeof bashStatusParameters, unknown, StatusWaitRenderState> {
  return defineTool<typeof bashStatusParameters, unknown, StatusWaitRenderState>({
    name: "bash_status",
    label: "bash_status",
    description:
      "Check background processes started in this session. Without an id, list them all with their state (running, completed with exit code, exited by signal, or cancelled), elapsed time, and command. With an id, show one process's output tail; with wait_seconds, block until it completes or the bound expires, then return its final state and output.",
    parameters: bashStatusParameters,
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const program =
        params.id === undefined
          ? processes.listBackgrounded().pipe(Effect.map((list) => formatProcessList(list)))
          : waitForProcess(processes, params.id, params.wait_seconds, signal).pipe(
              Effect.map((entry) => formatProcessDetail(entry, entry.output.outputSnapshot())),
            );

      const text = await Effect.runPromise(program);

      return { content: [{ type: "text", text }], details: undefined };
    },
    // Results only arrive when the wait ends, so the countdown ticker lives
    // here; renderResult clears the interval on completion.
    renderCall(args, theme, context) {
      const state = context.state;

      if (context.executionStarted && state.startedAt === undefined) {
        state.startedAt = Date.now();
      }

      if (state.startedAt !== undefined && (args.wait_seconds ?? 0) > 0 && !state.interval) {
        state.interval = setInterval(() => context.invalidate(), 1000);
      }

      const id = args.id === undefined ? "" : theme.fg("dim", ` ${args.id}`);
      let wait = "";

      if (
        args.wait_seconds !== undefined &&
        args.wait_seconds > 0 &&
        state.startedAt !== undefined
      ) {
        const remaining = Math.max(
          0,
          Math.ceil(args.wait_seconds - (Date.now() - state.startedAt) / 1000),
        );

        wait = theme.fg("dim", remaining > 0 ? ` (wait ${remaining}s)` : "");
      }

      return new Text(theme.fg("toolTitle", "◈ Bash status") + id + wait, 0, 0);
    },
    renderResult(result, options, theme, context) {
      const state = context.state;

      if (state.interval && (!options.isPartial || context.isError)) {
        clearInterval(state.interval);
        state.interval = undefined;
      }

      if (context.isError) return toolErrorResult(result, "◈", theme);

      if (options.expanded) return toolPreview(result, theme);

      return emptyToolResult();
    },
  });
}
