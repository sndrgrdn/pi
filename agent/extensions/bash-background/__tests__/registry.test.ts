import { describe, expect, it } from "vitest";
import { Effect, Fiber } from "effect";
import { BashError, bashError } from "../errors.ts";
import { ProcessSpawner } from "../process.ts";
import { createBackgroundProcesses, ProcessState } from "../registry.ts";

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

describe("BackgroundProcesses", () => {
  const killed: number[] = [];

  const fakeSpawner = ProcessSpawner.of({
    spawn: () => Effect.fail(bashError("spawn", { command: "unused" })),
    killTree: (pid) => Effect.sync(() => killed.push(pid)),
  });

  const makeRegistry = () => {
    killed.length = 0;
    const processes = createBackgroundProcesses(fakeSpawner);

    return processes;
  };

  const register = (processes: ReturnType<typeof makeRegistry>, pid: number) =>
    run(processes.register({ pid, command: `cmd ${pid}`, cwd: "/tmp" }));

  it("registers, gets, and lists processes", async () => {
    const processes = makeRegistry();
    await register(processes, 1);
    const entry = await run(processes.get(1));
    expect(entry.pid).toBe(1);
    expect(entry.state).toEqual(ProcessState.Running());
    expect(entry.backgrounded).toBe(false);
    expect(await run(processes.listBackgrounded())).toEqual([]);
  });

  it("lists only backgrounded processes, newest first", async () => {
    const processes = makeRegistry();
    await register(processes, 1);
    const second = await register(processes, 2);
    await run(processes.markBackgrounded(second.pid));
    const list = await run(processes.listBackgrounded());
    expect(list.map((entry) => entry.pid)).toEqual([2]);
  });

  it("marks finished processes with their exit code", async () => {
    const processes = makeRegistry();
    const entry = await register(processes, 1);
    await run(processes.markFinished(entry.pid, 3));
    expect(entry.state).toEqual(ProcessState.Completed({ exitCode: 3 }));
    expect(entry.finishedAt).toBeDefined();
  });

  it("does not overwrite a cancelled state with a late finish", async () => {
    const processes = makeRegistry();
    const entry = await register(processes, 1);
    await run(processes.kill(entry.pid));
    await run(processes.markFinished(entry.pid, 0));
    expect(entry.state).toEqual(ProcessState.Cancelled());
  });

  it("kills a running process through the spawner and marks it killed", async () => {
    const processes = makeRegistry();
    const entry = await register(processes, 42);
    const result = await run(processes.kill(entry.pid));
    expect(killed).toEqual([42]);
    expect(result.state).toEqual(ProcessState.Cancelled());
    expect(result.finishedAt).toBeDefined();
  });

  it("fails with typed errors for unknown or finished processes", async () => {
    const processes = makeRegistry();
    const notFound = await run(processes.kill(999).pipe(Effect.flip));
    expect(notFound).toBeInstanceOf(BashError);
    expect(notFound.kind).toBe("not_found");

    // A foreground entry is deleted when finished; kill returns not_found.
    const entry = await register(processes, 1);
    await run(processes.markFinished(entry.pid, 0));
    const finished = await run(processes.kill(entry.pid).pipe(Effect.flip));
    expect(finished).toBeInstanceOf(BashError);
    expect(finished.kind).toBe("not_found");
  });

  it("waitForCompletion resolves when the process finishes", async () => {
    const processes = makeRegistry();
    await register(processes, 1);
    const fiber = Effect.runFork(processes.waitForCompletion(1, 5));
    await run(processes.markFinished(1, 0));
    const entry = await Effect.runPromise(Fiber.join(fiber));
    expect(entry.state).toEqual(ProcessState.Completed({ exitCode: 0 }));
  });

  it("waitForCompletion resolves when the process is cancelled", async () => {
    const processes = makeRegistry();
    await register(processes, 1);
    const fiber = Effect.runFork(processes.waitForCompletion(1, 5));
    await run(processes.kill(1));
    const entry = await Effect.runPromise(Fiber.join(fiber));
    expect(entry.state).toEqual(ProcessState.Cancelled());
  });

  it("waitForCompletion returns immediately for finished processes or a zero bound", async () => {
    const processes = makeRegistry();
    await register(processes, 1);
    await run(processes.markBackgrounded(1));
    await run(processes.markFinished(1, 3));
    const finished = await run(processes.waitForCompletion(1, 5));
    expect(finished.state).toEqual(ProcessState.Completed({ exitCode: 3 }));

    await register(processes, 2);
    await run(processes.markBackgrounded(2));
    const running = await run(processes.waitForCompletion(2, 0));
    expect(running.state).toEqual(ProcessState.Running());
  });

  it("waitForCompletion expires at the bound for a running process", async () => {
    const processes = makeRegistry();
    await register(processes, 1);
    const startedAt = Date.now();
    const entry = await run(processes.waitForCompletion(1, 0.1));
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(80);
    expect(entry.state).toEqual(ProcessState.Running());
  });

  it("killAllBackgrounded kills only backgrounded running processes", async () => {
    const processes = makeRegistry();
    const foreground = await register(processes, 1);
    const backgrounded = await register(processes, 2);
    const finished = await register(processes, 3);
    await run(processes.markBackgrounded(backgrounded.pid));
    await run(processes.markBackgrounded(finished.pid));
    await run(processes.markFinished(finished.pid, 0));

    const count = await run(processes.killAllBackgrounded());
    expect(count).toBe(1);
    expect(killed).toEqual([2]);
    expect(foreground.state).toEqual(ProcessState.Running());
    expect(backgrounded.state).toEqual(ProcessState.Cancelled());
    expect(finished.state).toEqual(ProcessState.Completed({ exitCode: 0 }));
  });
});
