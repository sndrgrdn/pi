/**
 * Every command is registered while it runs; only processes actually moved
 * to the background are visible to `bash_status`.
 */

import { Context, Data, Deferred, Duration, Effect } from "effect";
import { bashError, toErrorString, type BashError } from "./errors.ts";
import type { ProcessSpawnerContract } from "./process.ts";
import { ShellOutputFile } from "./shell-output-file.ts";

/** running → completed (ended on its own) | cancelled (we SIGKILLed it). Null exit code = died on a signal. */
export type ProcessState = Data.TaggedEnum<{
  running: {};
  completed: { readonly exitCode: number | null };
  cancelled: {};
}>;

const processState = Data.taggedEnum<ProcessState>();

/** Constructors and matchers for process lifecycle states. */
export const ProcessState = {
  Running: processState.running,
  Completed: processState.completed,
  Cancelled: processState.cancelled,
  $is: processState.$is,
  $match: processState.$match,
};

/**
 * Live state of one spawned command.
 *
 * Mutable while it runs; `completion` resolves when the process leaves
 * "running". `backgrounded` controls visibility in `bash_status`.
 */
export class BackgroundProcess {
  backgrounded = false;
  state: ProcessState = ProcessState.Running();
  finishedAt: number | undefined;
  readonly pid: number;
  readonly command: string;
  readonly cwd: string;
  readonly startedAt: number;
  readonly output: ShellOutputFile;
  readonly completion: Deferred.Deferred<void, never>;

  constructor(
    pid: number,
    command: string,
    cwd: string,
    startedAt: number,
    output: ShellOutputFile,
    completion: Deferred.Deferred<void, never>,
  ) {
    this.pid = pid;
    this.command = command;
    this.cwd = cwd;
    this.startedAt = startedAt;
    this.output = output;
    this.completion = completion;
  }
}

/** Effect service tag for the background-process registry. */
export class BackgroundProcesses extends Context.Service<
  BackgroundProcesses,
  BackgroundProcessesContract
>()("@pi/bash-background/Processes") {}

/** Tracks spawned processes and controls their background lifecycle. */
export interface BackgroundProcessesContract {
  /** Fails with BashError("output") if the output file cannot be created. */
  register(input: {
    pid: number;
    command: string;
    cwd: string;
  }): Effect.Effect<BackgroundProcess, BashError>;
  /** Only these appear in bash_status. */
  markBackgrounded(id: number): Effect.Effect<void, never>;
  /** Record a natural exit (null = died on a signal); ignored once cancelled. */
  markFinished(id: number, exitCode: number | null): Effect.Effect<void, never>;
  /** Newest first. */
  listBackgrounded(): Effect.Effect<BackgroundProcess[], never>;
  /** Fails with BashError("not_found"). */
  get(id: number): Effect.Effect<BackgroundProcess, BashError>;
  /** Wait up to the bound (0 = no wait); returns the entry either way. Fails with BashError("not_found"). */
  waitForCompletion(id: number, waitSeconds: number): Effect.Effect<BackgroundProcess, BashError>;
  /** Fails with BashError("not_found" | "not_running"). */
  kill(id: number): Effect.Effect<BackgroundProcess, BashError>;
  /** Returns the kill count. */
  killAllBackgrounded(): Effect.Effect<number, never>;
}

/** Creates an in-memory registry whose kill operations use the process spawner. */
export function createBackgroundProcesses(
  spawner: ProcessSpawnerContract,
): BackgroundProcessesContract {
  const entries = new Map<number, BackgroundProcess>();

  const killEntry = Effect.fn("BashBackground.killEntry")(function* (entry: BackgroundProcess) {
    yield* spawner.killTree(entry.pid);
    entry.state = ProcessState.Cancelled();
    entry.finishedAt = Date.now();
    entry.output.close();
    yield* Deferred.succeed(entry.completion, void 0);

    if (!entry.backgrounded) entries.delete(entry.pid);
  });

  const service = BackgroundProcesses.of({
    register: Effect.fn("BashBackground.register")(function* ({ pid, command, cwd }) {
      const completion = yield* Deferred.make<void>();

      const entry = yield* Effect.try({
        try: () =>
          new BackgroundProcess(pid, command, cwd, Date.now(), new ShellOutputFile(), completion),
        catch: (cause) =>
          bashError("output", {
            id: pid,
            cause: toErrorString(cause),
          }),
      });

      entries.set(pid, entry);

      return entry;
    }),
    markBackgrounded: Effect.fn("BashBackground.markBackgrounded")(function* (id) {
      const entry = entries.get(id);

      if (entry) entry.backgrounded = true;
    }),
    markFinished: Effect.fn("BashBackground.markFinished")(function* (id, exitCode) {
      const entry = entries.get(id);

      if (entry && ProcessState.$is("running")(entry.state)) {
        entry.state = ProcessState.Completed({ exitCode });
        entry.finishedAt = Date.now();
        entry.output.close();
        yield* Deferred.succeed(entry.completion, void 0);

        if (!entry.backgrounded) entries.delete(id);
      }
    }),
    listBackgrounded: Effect.fn("BashBackground.listBackgrounded")(function* () {
      return [...entries.values()].filter((entry) => entry.backgrounded).reverse();
    }),
    get: Effect.fn("BashBackground.get")(function* (id) {
      const entry = entries.get(id);

      if (!entry) return yield* Effect.fail(bashError("not_found", { id }));

      return entry;
    }),
    waitForCompletion: Effect.fn("BashBackground.waitForCompletion")(function* (id, waitSeconds) {
      const entry = yield* service.get(id);

      if (
        ProcessState.$is("running")(entry.state) &&
        waitSeconds > 0 &&
        Number.isFinite(waitSeconds)
      ) {
        yield* Deferred.await(entry.completion).pipe(
          Effect.timeout(Duration.seconds(waitSeconds)),
          Effect.catchTag("TimeoutError", () => Effect.succeed(void 0)),
        );
      }

      return entry;
    }),
    kill: Effect.fn("BashBackground.kill")(function* (id) {
      const entry = yield* service.get(id);

      if (!ProcessState.$is("running")(entry.state)) {
        return yield* Effect.fail(bashError("not_running", { id }));
      }

      yield* killEntry(entry);

      return entry;
    }),
    killAllBackgrounded: Effect.fn("BashBackground.killAllBackgrounded")(function* () {
      const running = [...entries.values()].filter(
        (entry) => entry.backgrounded && ProcessState.$is("running")(entry.state),
      );

      for (const entry of running) {
        yield* killEntry(entry);
      }

      return running.length;
    }),
  });

  return service;
}
