/**
 * The bash override: backgrounding operations plus the tool definition.
 *
 * Timeouts are deliberately unsupported: a command that outlives the
 * auto-background delay is backgrounded, never killed by a deadline.
 * The foreground path plugs into pi's operations seam
 * (`createBashToolDefinition(cwd, { operations })`), so the builtin keeps
 * its output accumulation, truncation, and rendering; the
 * immediate-background path bypasses the seam (the flag cannot travel
 * through it) and spawns directly.
 */

import { delimiter, join } from "node:path";
import { Effect } from "effect";
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import {
  createBashToolDefinition,
  defineTool,
  getAgentDir,
  type BashOperations,
  type BashToolDetails,
  type ExtensionContext,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { BashError } from "./errors.ts";
import {
  BackgroundProcesses,
  ProcessState,
  type BackgroundProcess,
  type BackgroundProcessesContract,
} from "./registry.ts";
import { ProcessSpawner, type ProcessSpawnerContract } from "./process.ts";

/** Seconds a foreground command may run before it is moved to the background. */
export const AUTO_BACKGROUND_SECONDS = 30;

/** Dependencies and knobs for the backgrounding bash tool. */
export interface BackgroundingBashOptions {
  processes: BackgroundProcessesContract;
  spawner: ProcessSpawnerContract;
  /** Tests use small values. */
  autoBackgroundSeconds?: number;
}

type ExecOutcome =
  | { type: "exit"; exitCode: number | null }
  | { type: "abort" }
  | { type: "background"; notice: string };

/** Plain object like the builtin: unknown keys (e.g. legacy timeout) pass validation and are dropped. */
export const bashParameters = Type.Object({
  command: Type.String({ description: "Bash command to execute" }),
  background: Type.Optional(
    Type.Boolean({
      description: "Start the command in the background and return right away; it keeps running.",
    }),
  ),
});

/** Build the BashOperations seam that backs the foreground bash override. */
export function createBackgroundingBashOperations(
  options: BackgroundingBashOptions,
): BashOperations {
  const backgroundSeconds = options.autoBackgroundSeconds ?? AUTO_BACKGROUND_SECONDS;

  return {
    exec: async (command, cwd, { onData, signal, env }) => {
      const program = execProgram({
        command,
        cwd,
        onData,
        signal,
        env: env ?? {},
        backgroundSeconds,
        startBackgrounded: false,
      });

      const outcome = await program.pipe(
        Effect.provideService(BackgroundProcesses, options.processes),
        Effect.provideService(ProcessSpawner, options.spawner),
        Effect.runPromise,
      );

      if (outcome.type === "abort") {
        throw new Error("aborted");
      }

      if (outcome.type === "background") {
        onData(Buffer.from(outcome.notice));

        // Null exit code: the builtin treats it as "no error reported".
        return { exitCode: null };
      }

      return { exitCode: outcome.exitCode };
    },
  };
}

/** Everything the direct-spawn path (immediate backgrounding) needs. */
export interface BackgroundCommandInput {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  processes: BackgroundProcessesContract;
  spawner: ProcessSpawnerContract;
}

/** Spawn the command already backgrounded; resolves to the background notice. */
export function runBackgroundCommand(input: BackgroundCommandInput): Promise<string> {
  return execProgram({
    ...input,
    onData: () => {},
    signal: undefined,
    backgroundSeconds: AUTO_BACKGROUND_SECONDS,
    startBackgrounded: true,
  })
    .pipe(
      Effect.provideService(BackgroundProcesses, input.processes),
      Effect.provideService(ProcessSpawner, input.spawner),
      Effect.runPromise,
    )
    .then((outcome) => (outcome.type === "background" ? outcome.notice : ""));
}

const execProgram = Effect.fn("BashBackground.exec")(function* ({
  command,
  cwd,
  onData,
  signal,
  env,
  backgroundSeconds,
  startBackgrounded,
}: {
  command: string;
  cwd: string;
  onData: (chunk: Buffer) => void;
  signal: AbortSignal | undefined;
  env: NodeJS.ProcessEnv;
  backgroundSeconds: number;
  startBackgrounded: boolean;
}): Effect.fn.Return<ExecOutcome, BashError, ProcessSpawner | BackgroundProcesses> {
  const spawner = yield* ProcessSpawner;
  const processes = yield* BackgroundProcesses;

  // Data is routed to the builtin accumulator while the command is in the
  // foreground and to the registry output file always (so bash_status can
  // show progress after backgrounding).
  let entry: BackgroundProcess | undefined;
  let foreground = true;

  const spawned = yield* spawner.spawn({
    command,
    cwd,
    env,
    onData: (chunk) => {
      entry?.output.appendOutput(chunk);

      if (foreground) onData(chunk);
    },
  });

  const created = yield* processes.register({ pid: spawned.pid, command, cwd });
  entry = created;

  // Forked detached so the sync outlives this fiber; `spawned.wait` is
  // memoized, so the waitExit arm below observes the same outcome.
  yield* spawned.wait
    .pipe(
      Effect.matchEffect({
        onFailure: (error) => Effect.fail(error),
        onSuccess: ({ exitCode }) => processes.markFinished(created.pid, exitCode),
      }),
    )
    .pipe(Effect.forkDetach);

  const backgroundNotice = (immediate: boolean): string =>
    immediate
      ? `\n\n[Command moved to the background (id: ${created.pid}). Check its progress with bash_status and cancel it with bash_cancel.]`
      : `\n\n[Command still running after ${backgroundSeconds}s. Moved to the background (id: ${created.pid}). Check its progress with bash_status and cancel it with bash_cancel.]`;

  if (startBackgrounded) {
    yield* processes.markBackgrounded(created.pid);
    foreground = false;

    return { type: "background", notice: backgroundNotice(true) };
  }

  const waitExit = spawned.wait.pipe(
    Effect.map(({ exitCode }) => ({ type: "exit" as const, exitCode })),
  );

  const arms: Array<Effect.Effect<ExecOutcome, BashError, never>> = [
    waitExit,
    Effect.sleep(backgroundSeconds * 1000).pipe(
      Effect.map(() => ({ type: "background" as const, notice: backgroundNotice(false) })),
    ),
  ];

  if (signal) {
    arms.push(
      Effect.promise(
        () =>
          new Promise<ExecOutcome>((resolve) => {
            if (signal.aborted) {
              resolve({ type: "abort" });
            } else {
              signal.addEventListener("abort", () => resolve({ type: "abort" }), { once: true });
            }
          }),
      ),
    );
  }

  const outcome = yield* Effect.raceAll(arms);

  if (outcome.type === "exit") {
    return { type: "exit", exitCode: outcome.exitCode };
  }

  if (outcome.type === "abort") {
    yield* processes.kill(created.pid).pipe(Effect.ignore);

    return { type: "abort" };
  }

  // The process won the race to exit between the timer firing and here.
  if (!ProcessState.$is("running")(created.state)) {
    return {
      type: "exit",
      exitCode: ProcessState.$is("completed")(created.state) ? created.state.exitCode : null,
    };
  }

  yield* processes.markBackgrounded(created.pid);
  foreground = false;

  return outcome;
});

/**
 * Mirror pi's shell environment for the direct spawn path: PATH with pi's
 * bin dir first, plus the current session's PI_* metadata (same shape the
 * builtin builds for the ops seam).
 */
function resolveSessionEnv(ctx: ExtensionContext): NodeJS.ProcessEnv {
  const binDir = join(getAgentDir(), "bin");
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const currentPath = process.env[pathKey] ?? "";
  const entries = currentPath.split(delimiter).filter(Boolean);

  const updatedPath = entries.includes(binDir)
    ? currentPath
    : [binDir, currentPath].filter(Boolean).join(delimiter);

  const sessionFile = ctx.sessionManager.getSessionFile();

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    [pathKey]: updatedPath,
    PI_SESSION_ID: ctx.sessionManager.getSessionId(),
  };

  if (sessionFile !== undefined) env.PI_SESSION_FILE = sessionFile;

  if (ctx.model !== undefined) {
    env.PI_PROVIDER = ctx.model.provider;
    env.PI_MODEL = ctx.model.id;
  }

  if (ctx.thinkingLevel !== undefined) env.PI_REASONING_LEVEL = ctx.thinkingLevel;

  return env;
}

/** The bash override: backgrounding operations plus the tool definition, registered as `bash`. */
export function createBackgroundingBashDefinition(
  cwd: string,
  options: BackgroundingBashOptions,
): ToolDefinition<typeof bashParameters, BashToolDetails | undefined> {
  const bash = createBashToolDefinition(cwd, {
    operations: createBackgroundingBashOperations(options),
  });

  return defineTool({
    ...bash,
    parameters: bashParameters,
    description: `Execute a bash command in the current working directory. Returns stdout and stderr, truncated to the last 2000 lines or 50KB (whichever is hit first); if truncated, the full output is saved to a temp file. Commands that run longer than ${AUTO_BACKGROUND_SECONDS} seconds background themselves: the call returns with the output so far and the command keeps running. Pass background: true to background a command immediately. Check background processes with bash_status and cancel them with bash_cancel.`,
    // Never render a timeout suffix; keep the builtin's startedAt state so
    // the elapsed timer in the result row still works.
    renderCall(args, theme, context) {
      const state = context.state;

      if (context.executionStarted && state.startedAt === undefined) {
        state.startedAt = Date.now();
        state.endedAt = undefined;
      }

      const text =
        context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);

      const command = args?.command ?? "...";
      let rendered = theme.fg("toolTitle", theme.bold(`$ ${command}`));

      if (args?.background === true) rendered += theme.fg("dim", " (background)");
      text.setText(rendered);

      return text;
    },
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      if (params.background === true) {
        // The flag cannot travel through the ops seam, so spawn directly.
        const text = await runBackgroundCommand({
          command: params.command,
          cwd,
          env: resolveSessionEnv(ctx),
          processes: options.processes,
          spawner: options.spawner,
        });

        return { content: [{ type: "text", text }], details: undefined };
      }

      return bash.execute(toolCallId, { command: params.command }, signal, onUpdate, ctx);
    },
  });
}
