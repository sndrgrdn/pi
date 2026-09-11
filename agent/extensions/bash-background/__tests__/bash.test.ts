import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Compile } from "typebox/compile";
import { Effect } from "effect";
import type { TextContent } from "@earendil-works/pi-ai";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";

import {
  bashParameters,
  createBackgroundingBashDefinition,
  createBackgroundingBashOperations,
} from "../command.ts";
import { bashStatusToolDefinition } from "../status.ts";
import { bashCancelToolDefinition } from "../index.ts";
import { formatProcessDetail, formatProcessLine, formatProcessList } from "../status.ts";
import {
  createBackgroundProcesses,
  ProcessState,
  type BackgroundProcess,
  type BackgroundProcessesContract,
} from "../registry.ts";
import { createRealProcessSpawner, type ProcessSpawnerContract } from "../process.ts";

const AUTO_BACKGROUND_SECONDS = 0.2;

interface TestContext {
  spawner: ProcessSpawnerContract;
  processes: BackgroundProcessesContract;
  ops: ReturnType<typeof createBackgroundingBashOperations>;
}

let ctx: TestContext;

beforeEach(() => {
  const spawner = createRealProcessSpawner();
  const processes = createBackgroundProcesses(spawner);
  ctx = {
    spawner,
    processes,
    ops: createBackgroundingBashOperations({
      processes,
      spawner,
      autoBackgroundSeconds: AUTO_BACKGROUND_SECONDS,
    }),
  };
});

afterEach(async () => {
  await Effect.runPromise(ctx.processes.killAllBackgrounded());
});

/** Minimal execution context the builtin bash execute reads session env from. */
// SAFETY: the builtin bash execute reads only ctx.cwd and ctx.sessionManager;
// the real ExtensionContext demands many more members than this fake provides.
const fakeExecuteCtx = {
  cwd: process.cwd(),
  sessionManager: { getSessionId: () => "test", getSessionFile: () => undefined },
} as never;

const exec = (command: string, options: { signal?: AbortSignal; timeout?: number } = {}) => {
  const execOptions: Parameters<typeof ctx.ops.exec>[2] = {
    onData: () => {},
    env: process.env,
  };

  if (options.signal !== undefined) execOptions.signal = options.signal;

  if (options.timeout !== undefined) execOptions.timeout = options.timeout;

  return ctx.ops.exec(command, process.cwd(), execOptions);
};

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
};

const waitUntilDead = async (pid: number, timeoutMs = 3000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`process ${pid} still alive after ${timeoutMs}ms`);
};

const waitUntilStatus = async (id: number, status: ProcessState["_tag"], timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const entry = await Effect.runPromise(ctx.processes.get(id));

    if (ProcessState.$is(status)(entry.state)) return entry;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`process ${id} never reached ${status}`);
};

/** First text part of a tool result; the tools under test always emit one. */
function textOf(result: AgentToolResult<unknown>): string {
  const text = result.content.find((part): part is TextContent => part.type === "text");

  if (!text) throw new Error("test invariant: expected a text content part");

  return text.text;
}

/** First backgrounded entry; every caller has backgrounded one before reading. */
const firstEntry = async (): Promise<BackgroundProcess> => {
  const entries = await Effect.runPromise(ctx.processes.listBackgrounded());
  const entry = entries[0];

  if (!entry) throw new Error("test invariant: expected a background entry");

  return entry;
};

/** Minimal Theme the tested renderers touch: only fg and bold. */
// SAFETY: the tested renderCall/renderResult paths call only theme.fg and
// theme.bold; the real Theme type demands many more members than this fake.
const fakeTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as never;

/** Minimal ToolRenderContext for the tested renderers: state and executionStarted. */
// SAFETY: the tested renderers read only context.state, context.executionStarted,
// context.lastComponent and context.isError; the real ToolRenderContext type
// demands many more members than this fake provides.
const fakeRenderContext = <TState>(state: TState, executionStarted: boolean) =>
  ({ state, executionStarted, lastComponent: undefined }) as never;

describe("bash operations", () => {
  it("returns the exit code for a quick command", async () => {
    const result = await exec("echo hello");
    expect(result.exitCode).toBe(0);
    expect(await Effect.runPromise(ctx.processes.listBackgrounded())).toEqual([]);
  });

  it("surfaces non-zero exit codes", async () => {
    const result = await exec("exit 3");
    expect(result.exitCode).toBe(3);
  });

  it("ignores a passed timeout and backgrounds the command instead", async () => {
    // Timeouts are deliberately unsupported: nothing may kill a command.
    let output = "";

    const result = await ctx.ops.exec("sleep 30", process.cwd(), {
      onData: (chunk) => {
        output += chunk.toString("utf8");
      },
      timeout: 0.2,
      env: process.env,
    });

    expect(result.exitCode).toBeNull();
    expect(output).toContain("Moved to the background");
    const entries = await Effect.runPromise(ctx.processes.listBackgrounded());
    expect(entries).toHaveLength(1);
    const entry = entries[0];

    if (!entry) throw new Error("test invariant: expected a background entry");
    expect(entry.state).toEqual(ProcessState.Running());
  });

  it("aborts the command when the signal fires", async () => {
    const controller = new AbortController();
    const pending = exec("sleep 30", { signal: controller.signal });
    // The fiber attaches the abort listener before the first await yields,
    // so aborting right away is deterministic.
    controller.abort();
    await expect(pending).rejects.toThrow("aborted");
  });

  it("moves a long-running command to the background after the delay", async () => {
    let output = "";

    const result = await ctx.ops.exec("sleep 30", process.cwd(), {
      onData: (chunk) => {
        output += chunk.toString("utf8");
      },
      env: process.env,
    });

    expect(result.exitCode).toBeNull();
    expect(output).toContain("Moved to the background (id:");
    const entries = await Effect.runPromise(ctx.processes.listBackgrounded());
    expect(entries).toHaveLength(1);
    const entry = entries[0];

    if (!entry) throw new Error("test invariant: expected a background entry");
    expect(entry.state).toEqual(ProcessState.Running());
    expect(entry.backgrounded).toBe(true);

    const pid = entry.pid;
    expect(isProcessAlive(pid)).toBe(true);

    await Effect.runPromise(ctx.processes.kill(entry.pid));
    await waitUntilDead(pid);
  });

  it("reports completion when a backgrounded command finishes", async () => {
    const result = await exec("sleep 0.4");
    expect(result.exitCode).toBeNull();

    const entry = await waitUntilStatus((await firstEntry()).pid, "completed");
    expect(entry.state).toEqual(ProcessState.Completed({ exitCode: 0 }));
  });

  it("reports a signal exit as exited (signal), not completed with a null code", async () => {
    const result = await exec("sleep 30");
    expect(result.exitCode).toBeNull();
    const entry = await firstEntry();

    // An external kill (not bash_cancel) terminates the process by signal.
    process.kill(entry.pid, "SIGKILL");
    const finished = await waitUntilStatus(entry.pid, "completed");
    expect(finished.state).toEqual(ProcessState.Completed({ exitCode: null }));
    expect(formatProcessLine(finished, finished.startedAt + 1000)).toContain("exited (signal)");
  });
});

describe("bash definition", () => {
  const tool = () =>
    createBackgroundingBashDefinition(process.cwd(), {
      processes: ctx.processes,
      spawner: ctx.spawner,
      autoBackgroundSeconds: AUTO_BACKGROUND_SECONDS,
    });

  it("exposes only command and background parameters", () => {
    expect(Object.keys(tool().parameters.properties)).toEqual(["command", "background"]);
  });

  it("accepts unknown parameters such as timeout and ignores them", () => {
    const check = Compile(bashParameters);
    expect(check.Check({ command: "echo hi" })).toBe(true);
    expect(check.Check({ command: "echo hi", background: true })).toBe(true);
    expect(check.Check({ command: "echo hi", timeout: 45 })).toBe(true);
    expect(check.Check({ command: "echo hi", background: true, timeout: 45 })).toBe(true);
  });

  it("drops a legacy timeout parameter instead of killing the command at it", async () => {
    const startedAt = Date.now();

    const result = await tool().execute(
      "tool-id",
      // 0.05s bogus timeout; if honored, the command would die at 50ms.
      // SAFETY: legacy raw args may carry a timeout key the schema drops; the
      // tool's execute reads only command (and background).
      { command: "sleep 0.15; echo DONE", timeout: 0.05 } as never,
      undefined,
      undefined,
      fakeExecuteCtx,
    );

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(100);
    expect(textOf(result)).toContain("DONE");
  });

  it("renders the call line without any timeout suffix, even for raw args", () => {
    const renderCall = tool().renderCall;

    if (!renderCall) throw new Error("test invariant: bash tool defines renderCall");

    // SAFETY: legacy raw args may carry a timeout key the schema drops; the
    // renderer reads only command and background.
    const text = renderCall(
      { command: "echo hi", timeout: 45 } as never,
      fakeTheme,
      fakeRenderContext({}, false),
    );

    const line = text
      .render(200)
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .join("|");

    expect(line).toContain("$ echo hi");
    expect(line).not.toContain("timeout");
  });

  it("returns the notice in the tool result when auto-backgrounded", async () => {
    const result = await tool().execute(
      "tool-id",
      { command: "sleep 30" },
      undefined,
      undefined,
      fakeExecuteCtx,
    );

    const text = textOf(result);
    expect(text).toContain(`Command still running after ${AUTO_BACKGROUND_SECONDS}s`);
    expect(text).toContain("bash_status");
    expect(text).toContain("bash_cancel");
  });

  it("starts a command in the background immediately when background is set", async () => {
    const startedAt = Date.now();

    const result = await tool().execute(
      "tool-id",
      { command: "sleep 30", background: true },
      undefined,
      undefined,
      fakeExecuteCtx,
    );

    const text = textOf(result);
    expect(text).toContain("Command moved to the background (id:");
    expect(Date.now() - startedAt).toBeLessThan(1000);
    const entries = await Effect.runPromise(ctx.processes.listBackgrounded());
    expect(entries).toHaveLength(1);
    const entry = entries[0];

    if (!entry) throw new Error("test invariant: expected a background entry");
    expect(entry.state).toEqual(ProcessState.Running());
  });

  it("wraps a non-zero exit in the standard error", async () => {
    await expect(
      tool().execute("tool-id", { command: "exit 3" }, undefined, undefined, fakeExecuteCtx),
    ).rejects.toThrow("Command exited with code 3");
  });
});

describe("bash_status and bash_cancel tool definitions", () => {
  const statusTool = () => bashStatusToolDefinition(ctx.processes);
  const killTool = () => bashCancelToolDefinition(ctx.processes);

  /** Minimal mutable state the status tool's renderCall writes into. */
  interface RenderStateProbe {
    startedAt?: number;
    interval?: ReturnType<typeof setInterval>;
  }

  const renderState = (): RenderStateProbe => ({});

  it("reports no background processes when none exist", async () => {
    expect(textOf(await statusTool().execute("id", {}, undefined, undefined, fakeExecuteCtx))).toBe(
      "No background processes.",
    );
  });

  it("counts down the wait in the call line while the call runs", () => {
    const lineOf = (text: { render: (width: number) => string[] }) =>
      text
        .render(200)
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .join("|");

    const state = renderState();
    const context = fakeRenderContext(state, true);

    const renderCall = (args: { id?: number; wait_seconds?: number }) => {
      const call = statusTool().renderCall;

      if (!call) throw new Error("test invariant: status tool defines renderCall");

      return call(args, fakeTheme, context);
    };

    expect(lineOf(renderCall({ id: 1, wait_seconds: 10 }))).toBe("◈ Bash status 1 (wait 10s)");

    state.startedAt = Date.now() - 3000;
    expect(lineOf(renderCall({ id: 1, wait_seconds: 10 }))).toContain("(wait 7s)");

    state.startedAt = Date.now() - 11000;
    expect(lineOf(renderCall({ id: 1, wait_seconds: 10 }))).not.toContain("wait");

    clearInterval(state.interval);
  });

  it("starts no ticker for a plain status call", () => {
    const state = renderState();
    const context = fakeRenderContext(state, true);
    const renderCall = statusTool().renderCall;

    if (!renderCall) throw new Error("test invariant: status tool defines renderCall");
    renderCall({ id: 1 }, fakeTheme, context);
    expect(state.interval).toBeUndefined();
  });

  it("clears the ticker when the result arrives", () => {
    const state = renderState();
    const context = fakeRenderContext(state, true);
    const renderCall = statusTool().renderCall;

    if (!renderCall) throw new Error("test invariant: status tool defines renderCall");
    renderCall({ id: 1, wait_seconds: 10 }, fakeTheme, context);
    expect(state.interval).toBeDefined();
    const renderResult = statusTool().renderResult;

    if (!renderResult) throw new Error("test invariant: status tool defines renderResult");
    renderResult(
      { content: [{ type: "text", text: "x" }], details: undefined },
      { expanded: false, isPartial: false },
      fakeTheme,
      context,
    );
    expect(state.interval).toBeUndefined();
  });

  it("fails with a typed message for an unknown id", async () => {
    await expect(
      statusTool().execute("id", { id: 99999 }, undefined, undefined, fakeExecuteCtx),
    ).rejects.toThrow("No background process with id 99999");
  });

  it("bash_cancel kills and reports the process state", async () => {
    const { exitCode } = await exec("sleep 30");
    expect(exitCode).toBeNull();
    const pid = (await firstEntry()).pid;

    const result = await killTool().execute(
      "id",
      { id: pid },
      undefined,
      undefined,
      fakeExecuteCtx,
    );

    expect(textOf(result)).toBe(`Cancelled background process ${pid} (sleep 30).`);
    await waitUntilDead(pid);

    await expect(
      killTool().execute("id", { id: pid }, undefined, undefined, fakeExecuteCtx),
    ).rejects.toThrow(`Background process ${pid} is not running`);
  });

  it("waits for completion when wait_seconds is set", async () => {
    const { exitCode } = await exec("sleep 0.4; echo DONE");
    expect(exitCode).toBeNull();
    const pid = (await firstEntry()).pid;

    const result = await statusTool().execute(
      "id",
      { id: pid, wait_seconds: 5 },
      undefined,
      undefined,
      fakeExecuteCtx,
    );

    expect(textOf(result)).toContain("completed (exit 0)");
    expect(textOf(result)).toContain("DONE");
  });

  it("returns a running snapshot when the wait bound expires", async () => {
    const { exitCode } = await exec("sleep 30");
    expect(exitCode).toBeNull();
    const pid = (await firstEntry()).pid;

    const startedAt = Date.now();

    const result = await statusTool().execute(
      "id",
      { id: pid, wait_seconds: 1 },
      undefined,
      undefined,
      fakeExecuteCtx,
    );

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(900);
    expect(textOf(result)).toContain("running");
  });

  it("bash_cancel preempts an in-flight status wait", async () => {
    const { exitCode } = await exec("sleep 30");
    expect(exitCode).toBeNull();
    const pid = (await firstEntry()).pid;

    const pending = statusTool().execute(
      "id",
      { id: pid, wait_seconds: 10 },
      undefined,
      undefined,
      fakeExecuteCtx,
    );

    // The wait and its Deferred are attached before execute returns; killing
    // right away preempts the wait deterministically.
    await killTool().execute("id", { id: pid }, undefined, undefined, fakeExecuteCtx);
    expect(textOf(await pending)).toContain("cancelled");
  });

  it("aborts the status wait when the signal fires", async () => {
    const { exitCode } = await exec("sleep 30");
    expect(exitCode).toBeNull();
    const pid = (await firstEntry()).pid;

    const controller = new AbortController();

    const pending = statusTool().execute(
      "id",
      { id: pid, wait_seconds: 10 },
      controller.signal,
      undefined,
      fakeExecuteCtx,
    );

    // The abort listener is attached before execute returns; aborting right
    // away ends the wait deterministically.
    controller.abort();
    await expect(pending).rejects.toThrow("Status check aborted");
  });

  it("formats process lines and details", async () => {
    const { exitCode } = await exec("sleep 0.3");
    expect(exitCode).toBeNull();
    const entry = await waitUntilStatus((await firstEntry()).pid, "completed");

    const line = formatProcessLine(entry, entry.startedAt + 12_000);
    expect(line).toContain(`- id ${entry.pid} · completed (exit 0) · 12.0s · \`sleep 0.3\``);

    const detail = formatProcessDetail(entry, {
      tail: "some output",
      totalBytes: 11,
      fullPath: "/tmp/full.log",
    });

    expect(detail).toContain("some output");
    expect(detail).toContain("Full output: /tmp/full.log");

    const formatted = formatProcessList([entry], entry.startedAt + 1000);
    expect(formatted).toContain("Background processes:");
  });
});
