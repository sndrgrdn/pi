import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  InMemoryCredentialStore,
  InMemoryModelsStore,
  createProvider,
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai";
import { TYPESAFE_CLASSIFIER_MODELS } from "@earendil-works/pi-ai/providers/typesafe.models";
import {
  ExtensionRunner,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  discoverAndLoadExtensions,
  type ExtensionError,
  type TerminalInputHandler,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { workRewrite } from "./responses.ts";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "friendly-prompts-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", directory);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

async function loadExtension() {
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
    modelsPath: null,
    refreshOnCreate: false,
  });

  const rewrite = fauxProvider({ provider: "rewrite", models: [{ id: "small" }] });

  runtime.registerNativeProvider(rewrite.provider);
  runtime.registerNativeProvider(
    createProvider({
      id: "typesafe",
      auth: rewrite.provider.auth,
      models: [TYPESAFE_CLASSIFIER_MODELS["jev-latest"]],
      classifiers: {
        "typesafe-system-one": {
          classify: async () => ({
            api: "typesafe-system-one",
            provider: "typesafe",
            model: "jev-latest",
            answers: { hostile: { type: "bool", probability: 0.99 } },
            stopReason: "stop",
            timestamp: 0,
          }),
        },
      },
    }),
  );

  const loaded = await discoverAndLoadExtensions(
    [resolve("agent/extensions/friendly-prompts/index.ts")],
    directory,
    directory,
  );

  expect(loaded.errors).toEqual([]);

  const runner = new ExtensionRunner(
    loaded.extensions,
    loaded.runtime,
    directory,
    SessionManager.inMemory(directory),
    new ModelRegistry(runtime),
  );

  const errors: ExtensionError[] = [];
  const inputListeners = new Set<TerminalInputHandler>();

  runner.setUIContext(
    {
      ...runner.getUIContext(),
      onTerminalInput: (handler) => {
        inputListeners.add(handler);

        return () => {
          inputListeners.delete(handler);
        };
      },
    },
    "tui",
  );

  function pressKey(data: string): boolean {
    for (const listener of inputListeners) {
      if (listener(data)?.consume) return true;
    }

    return false;
  }

  runner.onError((error) => errors.push(error));
  await runner.emit({ type: "session_start", reason: "startup" });

  return { runner, rewrite, errors, pressKey, inputListeners };
}

describe("friendly prompt extension", () => {
  it("configures through its command, rewrites through Pi's input hook, and reloads saved settings", async () => {
    const { runner, rewrite, errors } = await loadExtension();
    const command = runner.getCommand("friendly-prompts");

    expect(command).toBeDefined();
    expect(await runner.emitInput("fix this, idiot", undefined, "interactive")).toEqual({
      action: "continue",
    });
    await command?.handler("rewrite/small", runner.createCommandContext());

    expect(JSON.parse(await readFile(join(directory, "friendly-prompts.json"), "utf8"))).toEqual({
      rewriteModel: { provider: "rewrite", id: "small" },
      classifier: { provider: "typesafe", id: "jev-latest" },
      threshold: 0.8,
      timeoutMs: 10_000,
    });

    rewrite.setResponses([fauxAssistantMessage(JSON.stringify(workRewrite("Please fix this.")))]);

    expect(await runner.emitInput("fix this, idiot", undefined, "interactive")).toMatchObject({
      action: "transform",
      text: workRewrite("Please fix this.").body,
    });

    await runner.emit({ type: "session_start", reason: "reload" });
    rewrite.setResponses([
      fauxAssistantMessage(JSON.stringify(workRewrite("Please fix this again."))),
    ]);

    expect(await runner.emitInput("fix this again, idiot", undefined, "interactive")).toMatchObject(
      { action: "transform", text: workRewrite("Please fix this again.").body },
    );
    expect(errors).toEqual([]);
  });

  it.each(["\u001b", "\u0003"])("cancels an idle submission on key %j", async (key) => {
    const { runner, rewrite, errors, pressKey, inputListeners } = await loadExtension();

    await runner
      .getCommand("friendly-prompts")
      ?.handler("rewrite/small", runner.createCommandContext());

    const started = Promise.withResolvers<AbortSignal | undefined>();

    rewrite.setResponses([
      (_context, options) => {
        started.resolve(options?.signal);

        return new Promise(() => {});
      },
    ]);

    expect(runner.createContext().signal).toBeUndefined();
    expect(pressKey(key)).toBe(false);

    const pending = runner.emitInput("fix this, idiot", undefined, "interactive");
    const signal = await started.promise;

    expect(pressKey("x")).toBe(false);
    expect(pressKey(key)).toBe(true);
    expect(await pending).toEqual({ action: "handled" });
    expect(signal?.aborted).toBe(true);
    expect(pressKey(key)).toBe(false);

    await runner.emit({ type: "session_start", reason: "reload" });

    expect(inputListeners.size).toBe(1);

    await runner.emit({ type: "session_shutdown", reason: "quit" });

    expect(inputListeners.size).toBe(0);
    expect(errors).toEqual([]);
  });

  it("does not replace saved settings when model selection is invalid", async () => {
    const { runner } = await loadExtension();
    const command = runner.getCommand("friendly-prompts");

    await command?.handler("rewrite/small", runner.createCommandContext());

    const saved = await readFile(join(directory, "friendly-prompts.json"), "utf8");

    await command?.handler("missing/model", runner.createCommandContext());

    expect(await readFile(join(directory, "friendly-prompts.json"), "utf8")).toBe(saved);
  });

  it("preserves malformed configuration and passes prompts through", async () => {
    const path = join(directory, "friendly-prompts.json");
    const malformed = '{"threshold": "wrong"}';

    await writeFile(path, malformed);

    const { runner, errors } = await loadExtension();

    expect(await runner.emitInput("fix this, idiot", undefined, "interactive")).toMatchObject({
      action: "continue",
    });
    expect(await readFile(path, "utf8")).toBe(malformed);
    expect(errors).toEqual([]);
  });
});
