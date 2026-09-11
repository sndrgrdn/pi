/**
 * Process boundary for the bash backgrounding extension.
 *
 * Mirrors pi's local shell backend (`createLocalBashOperations` and
 * `waitForChildProcess`): spawn the user's shell detached into its own
 * process group, stream stdout/stderr, and wait for exit plus drained
 * stdio (so detached descendants holding the pipes cannot hang the wait).
 * `killTree` SIGKILLs the whole process group, with a direct-kill fallback.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { getShellConfig } from "@earendil-works/pi-coding-agent";
import { Context, Deferred, Effect } from "effect";
import { bashError, toErrorString, type BashError } from "./errors.ts";

/** Grace period after exit before declaring stdio drained (mirrors pi). */
const EXIT_STDIO_GRACE_MS = 100;

/**
 * macOS ships bash 3.2, whose `$()` parser mishandles quotes inside
 * heredocs (e.g. an apostrophe in a heredoc body inside "$(cat <<'EOF' …)"
 * is read as an unterminated string). Prefer Homebrew's bash 5 when
 * present (proven in the mori/shell toolbox).
 */
const HOMEBREW_BASH = "/opt/homebrew/bin/bash";

function resolveShellConfig() {
  return getShellConfig(existsSync(HOMEBREW_BASH) ? HOMEBREW_BASH : undefined);
}

/** `wait` is memoized: one Deferred per process, so every awaiter observes the same outcome. */
export interface SpawnedProcess {
  readonly pid: number;
  readonly wait: Effect.Effect<{ exitCode: number | null }, BashError>;
}

/** Context tag for the ProcessSpawner service. */
export class ProcessSpawner extends Context.Service<ProcessSpawner, ProcessSpawnerContract>()(
  "@pi/bash-background/ProcessSpawner",
) {}

/** Input to `ProcessSpawnerContract.spawn`: the shell line and its environment. */
export interface SpawnShellOptions {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  onData: (chunk: Buffer) => void;
}

/** Service contract for spawning and killing background shell processes. */
export interface ProcessSpawnerContract {
  readonly spawn: (options: SpawnShellOptions) => Effect.Effect<SpawnedProcess, BashError>;
  /** SIGKILL the process group; never fails. */
  readonly killTree: (pid: number) => Effect.Effect<void, never>;
}

/** Real child_process-based spawner; spawn/kill failures are translated to BashError. */
export function createRealProcessSpawner(): ProcessSpawnerContract {
  return ProcessSpawner.of({
    spawn: Effect.fn("BashBackground.spawn")(function* ({ command, cwd, env, onData }) {
      const completion = yield* Deferred.make<{ exitCode: number | null }, BashError>();

      const child = yield* Effect.try({
        try: () => spawnShell(command, cwd, env, onData),
        catch: (cause) =>
          bashError("spawn", {
            command,
            cause: toErrorString(cause),
          }),
      });

      if (child.pid === undefined) {
        return yield* Effect.fail(
          bashError("spawn", { command, cause: "shell failed to start (no pid assigned)" }),
        );
      }

      yield* Effect.tryPromise({
        try: () => waitForChildProcess(child),
        catch: (cause) =>
          bashError("spawn", {
            command,
            cause: toErrorString(cause),
          }),
      }).pipe(
        Effect.matchEffect({
          onSuccess: (result) => Deferred.succeed(completion, result),
          onFailure: (error) => Deferred.fail(completion, error),
        }),
        Effect.forkDetach,
      );

      return { pid: child.pid, wait: Deferred.await(completion) };
    }),
    killTree: Effect.fn("BashBackground.killTree")((pid) =>
      Effect.sync(() => killProcessTree(pid)),
    ),
  });
}

function spawnShell(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  onData: (chunk: Buffer) => void,
): ChildProcess {
  const shellConfig = resolveShellConfig();
  const commandFromStdin = shellConfig.commandTransport === "stdin";

  const child = spawn(
    shellConfig.shell,
    commandFromStdin ? shellConfig.args : [...shellConfig.args, command],
    {
      cwd,
      detached: process.platform !== "win32",
      env,
      stdio: [commandFromStdin ? "pipe" : "ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  if (commandFromStdin) {
    child.stdin?.on("error", () => {});
    child.stdin?.end(command);
  }

  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);

  return child;
}

function killProcessTree(pid: number): void {
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
        stdio: "ignore",
        detached: true,
        windowsHide: true,
      });
    } catch {
      // taskkill failed; nothing else to do on win32.
    }

    return;
  }

  try {
    process.kill(-pid, "SIGKILL");

    return;
  } catch {
    // No such process group; fall through to a direct kill.
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Process already gone.
  }
}

/**
 * Ported from pi's `waitForChildProcess` (dist/utils/child-process.js):
 * resolves when the process exited AND both streams ended, with a grace
 * timer after exit so late-arriving output is not truncated.
 */
function waitForChildProcess(child: ChildProcess): Promise<{ exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let exited = false;
    let exitCode: number | null = null;
    let postExitTimer: NodeJS.Timeout | undefined;
    let stdoutEnded = child.stdout === null;
    let stderrEnded = child.stderr === null;

    const cleanup = () => {
      if (postExitTimer) {
        clearTimeout(postExitTimer);
        postExitTimer = undefined;
      }

      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      child.removeListener("close", onClose);
      child.stdout?.removeListener("end", onStdoutEnd);
      child.stderr?.removeListener("end", onStderrEnd);
      child.stdout?.removeListener("data", onData);
      child.stderr?.removeListener("data", onData);
    };

    const finalize = (code: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve({ exitCode: code });
    };

    const maybeFinalizeAfterExit = () => {
      if (!exited || settled) return;

      if (stdoutEnded && stderrEnded) {
        finalize(exitCode);
      }
    };

    const armIdleTimer = () => {
      if (postExitTimer) clearTimeout(postExitTimer);
      postExitTimer = setTimeout(() => finalize(exitCode), EXIT_STDIO_GRACE_MS);
    };

    const onData = () => {
      // Output is still arriving after exit; defer finalizing so we don't
      // destroy the stream mid-write and truncate the tail.
      if (exited && !settled) armIdleTimer();
    };

    const onStdoutEnd = () => {
      stdoutEnded = true;
      maybeFinalizeAfterExit();
    };

    const onStderrEnd = () => {
      stderrEnded = true;
      maybeFinalizeAfterExit();
    };

    const onError = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const onExit = (code: number | null) => {
      exited = true;
      exitCode = code;
      maybeFinalizeAfterExit();

      if (!settled) {
        armIdleTimer();
      }
    };

    const onClose = (code: number | null) => {
      finalize(code);
    };

    child.stdout?.once("end", onStdoutEnd);
    child.stderr?.once("end", onStderrEnd);
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
    child.once("close", onClose);
  });
}
