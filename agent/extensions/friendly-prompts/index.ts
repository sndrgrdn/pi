import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";
import * as Schema from "effect/Schema";
import { Configuration, transformInput } from "./rewrite.ts";

export default function friendlyPrompts(pi: ExtensionAPI) {
  const configurationPath = join(getAgentDir(), "friendly-prompts.json");
  let configuration: Configuration | undefined;
  let sessionController: AbortController | undefined;
  let unsubscribeInput: (() => void) | undefined;
  const pendingInputs = new Set<AbortController>();

  pi.on("session_start", async (_event, ctx) => {
    sessionController?.abort();
    unsubscribeInput?.();
    unsubscribeInput = undefined;
    sessionController = new AbortController();
    configuration = undefined;

    if (ctx.mode === "tui") {
      unsubscribeInput = ctx.ui.onTerminalInput((data) => {
        if (!pendingInputs.size || !(matchesKey(data, "escape") || matchesKey(data, "ctrl+c"))) {
          return undefined;
        }

        for (const controller of pendingInputs) controller.abort();

        return ctx.isIdle() ? { consume: true } : undefined;
      });
    }

    if (!existsSync(configurationPath)) {
      ctx.ui.notify(
        "Choose a rewrite model with /friendly-prompts to enable friendly prompts.",
        "info",
      );

      return;
    }

    try {
      configuration = Schema.decodeUnknownSync(Configuration)(
        JSON.parse(await readFile(configurationPath, "utf8")),
      );
    } catch {
      ctx.ui.notify(
        `Friendly prompts disabled: invalid or unreadable ${configurationPath}.`,
        "warning",
      );
    }
  });

  pi.registerCommand("friendly-prompts", {
    description: "Choose and save the model that makes hostile prompts friendly",
    handler: async (args, ctx) => {
      const models = await ctx.modelRegistry.getAvailableOfType("chat");
      const choices = models.map((model) => `${model.provider}/${model.id}`);

      const selected =
        args.trim() || (await ctx.ui.select("Friendly prompt rewrite model", choices));

      if (!selected) return;

      const model = models.find(
        (candidate) => `${candidate.provider}/${candidate.id}` === selected,
      );

      if (!model) {
        ctx.ui.notify("Choose an available provider/model with /friendly-prompts.", "warning");

        return;
      }

      const updated: Configuration = {
        rewriteModel: { provider: model.provider, id: model.id },
        classifier: configuration?.classifier ?? { provider: "typesafe", id: "jev-latest" },
        threshold: configuration?.threshold ?? 0.8,
        timeoutMs: configuration?.timeoutMs ?? 10_000,
      };

      const temporaryPath = `${configurationPath}.${randomUUID()}.tmp`;

      try {
        await mkdir(getAgentDir(), { recursive: true });
        await writeFile(temporaryPath, `${JSON.stringify(updated, null, 2)}\n`, { mode: 0o600 });
        await rename(temporaryPath, configurationPath);
        configuration = updated;
        ctx.ui.notify(
          `Friendly prompts enabled using ${selected}. Settings: ${configurationPath}`,
          "info",
        );

        const available = await ctx.modelRegistry.getAvailableOfType(
          "classifier",
          updated.classifier.provider,
        );

        if (!available.some((candidate) => candidate.id === updated.classifier.id)) {
          ctx.ui.notify(
            "The classifier is unavailable. Configure its credentials or friendly-prompts.json; prompts will pass through unchanged until then.",
            "warning",
          );
        }
      } catch {
        ctx.ui.notify("Could not save friendly prompt settings.", "error");
      } finally {
        await rm(temporaryPath, { force: true });
      }
    },
  });

  pi.on("input", async (event, ctx) => {
    if (!configuration) return { action: "continue" };

    const controller = new AbortController();

    const signals = [controller.signal, ctx.signal, sessionController?.signal].flatMap((signal) =>
      signal ? [signal] : [],
    );

    pendingInputs.add(controller);

    try {
      return await transformInput(
        event,
        ctx.modelRegistry,
        configuration,
        AbortSignal.any(signals),
      );
    } finally {
      pendingInputs.delete(controller);
    }
  });

  pi.on("session_shutdown", () => {
    sessionController?.abort();
    unsubscribeInput?.();
    unsubscribeInput = undefined;
  });
}
