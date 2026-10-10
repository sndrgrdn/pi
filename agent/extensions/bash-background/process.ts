import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { getShellConfig } from "@earendil-works/pi-coding-agent";
import { Context, Deferred, Effect } from "effect";
import { bashError, toErrorString, type BashError } from "./errors.ts";

const EXIT_STDIO_GRACE_MS = 100;

const HOMEBREW_BASH = "/opt/homebrew/bin/bash";

function resolveShellConfig() {
  return getShellConfig(existsSync(HOMEBREW_BASH) ? HOMEBREW_BASH : undefined);
}

/** `wait` is memoized: one Deferred per process, so every awaiter observes the same outcome. */
export interface SpawnedProcess {
  readonly pid: number;
  readonly wait: Effect.Effect<{ exitCode: number | null }, BashError>;
}

export class ProcessSpawner extends Context.Service<ProcessSpawner, ProcessSpawnerContract>()(
  "@pi/bash-background/ProcessSpawner",
) {}

export interface SpawnShellOptions {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  onData: (chunk: Buffer) => void;
}

export interface ProcessSpawnerContract {
  readonly spawn: (options: SpawnShellOptions) => Effect.Effect<SpawnedProcess, BashError>;
  readonly killTree: (pid: number) => Effect.Effect<void, never>;
}

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
    } catch {}

    return;
  }

  try {
    process.kill(-pid, "SIGKILL");

    return;
  } catch {}

  try {
    process.kill(pid, "SIGKILL");
  } catch {}
}

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
