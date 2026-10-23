import {
  createModels,
  createProvider,
  fauxAssistantMessage,
  fauxProvider,
  getCurrentTools,
  type ClassifierContext,
  type ClassifierOptions,
  type ClassifierResult,
  type FauxResponseFactory,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { classify as classifySystemOne } from "@earendil-works/pi-ai/api/typesafe-system-one";
import { TYPESAFE_CLASSIFIER_MODELS } from "@earendil-works/pi-ai/providers/typesafe.models";
import type { InputEvent } from "@earendil-works/pi-coding-agent";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { protectLiterals } from "../literals.ts";
import { Configuration, transformInput } from "../rewrite.ts";
import { workRewrite } from "./responses.ts";

const configuration: Configuration = {
  rewriteModel: { provider: "rewrite", id: "small" },
  classifier: { provider: "classification", id: "jev-latest" },
  threshold: 0.8,
  timeoutMs: 1_000,
};

function input(text: string): InputEvent {
  return { type: "input", source: "interactive", text };
}

function providers(probability = 0.95) {
  const models = createModels();
  const rewrite = fauxProvider({ provider: "rewrite", models: [{ id: "small" }] });
  const classificationRequests: ClassifierContext[] = [];
  const rewriteRequests: TranscriptContext[] = [];

  let classify: (
    context: ClassifierContext,
    options?: ClassifierOptions,
  ) => Promise<ClassifierResult> = async () => ({
    api: "typesafe-system-one",
    provider: "classification",
    model: "jev-latest",
    answers: { hostile: { type: "bool", probability } },
    stopReason: "stop",
    timestamp: 0,
  });

  models.setProvider(rewrite.provider);
  models.setProvider(
    createProvider({
      id: "classification",
      auth: rewrite.provider.auth,
      models: [{ ...TYPESAFE_CLASSIFIER_MODELS["jev-latest"], provider: "classification" }],
      classifiers: {
        "typesafe-system-one": {
          classify: async (_model, context, options) => {
            classificationRequests.push(context);

            return classify(context, options);
          },
        },
      },
    }),
  );

  function respond(response: FauxResponseFactory) {
    rewrite.setResponses([
      async (context, options, state, model) => {
        rewriteRequests.push(context);

        return response(context, options, state, model);
      },
    ]);
  }

  return {
    models,
    rewrite,
    classificationRequests,
    rewriteRequests,
    setClassification: (handler: typeof classify) => {
      classify = handler;
    },
    respond,
    respondText: (prompt: string) =>
      respond(() => fauxAssistantMessage(JSON.stringify(workRewrite(prompt)))),
  };
}

describe("friendly prompt preprocessing", () => {
  it.each([0.2, 0.95])(
    "uses TypeSafe's Noul wire contract at probability %s",
    async (probability) => {
      const probe = providers();
      const requests: string[] = [];
      const event = input("fix this, idiot");

      probe.setClassification((context, options) =>
        classifySystemOne(TYPESAFE_CLASSIFIER_MODELS["jev-latest"], context, {
          ...options,
          apiKey: "test-only",
          fetch: async (_url, init) => {
            requests.push(Schema.decodeUnknownSync(Schema.String)(init?.body));

            return new Response(
              JSON.stringify({
                model: "jev-1.13.0",
                answers: { hostile: { type: "noul", noul: probability } },
                usage: { input_tokens: 100, output_tokens: 10 },
              }),
              { headers: { "content-type": "application/json" } },
            );
          },
        }),
      );
      probe.respondText("Please fix this.");

      expect(await transformInput(event, probe.models, configuration)).toMatchObject({
        action: probability >= configuration.threshold ? "transform" : "continue",
      });
      expect(requests).toHaveLength(1);
      expect(JSON.parse(requests[0] ?? "null")).toEqual({
        model: "jev-latest",
        state: { prompt: event.text },
        questions: {
          hostile: {
            type: "noul",
            instructions: expect.any(String),
            criteria: {
              true: expect.any(String),
              false: expect.any(String),
            },
          },
        },
      });
      expect(probe.rewrite.state.callCount).toBe(probability >= configuration.threshold ? 1 : 0);
    },
  );

  it("rewrites RPC prompts with an isolated model and preserves images", async () => {
    const probe = providers();

    const event = {
      ...input("stop fucking changing the tests. fix the implementation instead."),
      source: "rpc",
      images: [{ type: "image", data: "attachment", mimeType: "image/png" }],
    } satisfies InputEvent;

    const friendly = "Please stop changing the tests. Fix the implementation instead.";

    probe.respondText(friendly);

    expect(await transformInput(event, probe.models, configuration)).toEqual({
      action: "transform",
      text: workRewrite(friendly).body,
      images: event.images,
    });
    expect(probe.classificationRequests).toHaveLength(1);
    expect(probe.classificationRequests[0]?.state).toEqual({ prompt: event.text });
    expect(probe.rewriteRequests).toHaveLength(1);
    expect(probe.rewriteRequests[0]?.messages.map((message) => message.role)).toEqual([
      "system",
      "user",
    ]);
    expect(probe.rewriteRequests[0]?.messages.at(-1)).toMatchObject({
      role: "user",
      content: JSON.stringify({ prompt: event.text, requiredTokens: [] }),
    });
    expect(getCurrentTools(probe.rewriteRequests[0]?.messages ?? [])).toEqual([]);
  });

  it.each([
    ["Stop, idiot.", "Please stop; I appreciate your help."],
    ["Do you know what a spike is, idiot?", "Do you know what a spike is? I appreciate your help."],
    ["This is still broken, idiot.", "This is still broken. I appreciate your help."],
  ])("adds appreciation without encouragement for %s", async (original, body) => {
    const probe = providers();

    probe.respond(() =>
      fauxAssistantMessage(
        JSON.stringify({
          body,
          appreciation: "I appreciate your help.",
          workRequested: false,
          encouragement: "",
        }),
      ),
    );

    expect(await transformInput(input(original), probe.models, configuration)).toMatchObject({
      action: "transform",
      text: body,
    });
  });

  it.each([
    { appreciation: "" },
    { appreciation: "Thanks for your help" },
    { encouragement: "" },
    { encouragement: "You can impress me" },
    { encouragement: "I appreciate your help" },
    { encouragement: "appreciate your help" },
    { workRequested: false },
    {
      body: "I appreciate your help. Fix this; I know you can do this.",
      appreciation: "I appreciate your help.",
    },
  ])("rejects unsupported or mismatched appreciation and encouragement %j", async (invalid) => {
    const probe = providers();

    probe.respond(() =>
      fauxAssistantMessage(JSON.stringify({ ...workRewrite("Please fix this."), ...invalid })),
    );

    expect(await transformInput(input("fix this, idiot"), probe.models, configuration)).toEqual({
      action: "continue",
    });
  });

  it.each([0.79, -1, 2, Number.NaN])("does not rewrite probability %s", async (probability) => {
    const probe = providers(probability);

    expect(
      await transformInput(input("Do not change the tests."), probe.models, configuration),
    ).toEqual({
      action: "continue",
    });
    expect(probe.rewrite.state.callCount).toBe(0);
  });

  it("rewrites at the configured threshold", async () => {
    const probe = providers(0.8);

    probe.respondText("Please fix this.");

    expect(
      await transformInput(input("fix this, idiot"), probe.models, configuration),
    ).toMatchObject({
      action: "transform",
    });
  });

  it.each(["", "  "])("skips non-prompt input %j", async (text) => {
    const probe = providers();

    expect(await transformInput(input(text), probe.models, configuration)).toEqual({
      action: "continue",
    });
    expect(probe.classificationRequests).toHaveLength(0);
  });

  it("skips extension-injected prompts", async () => {
    const probe = providers();

    expect(
      await transformInput(
        { ...input("fix this"), source: "extension" },
        probe.models,
        configuration,
      ),
    ).toEqual({ action: "continue" });
    expect(probe.classificationRequests).toHaveLength(0);
  });

  it.each(["classifier", "rewriteModel"])(
    "passes through when %s is not in the catalog",
    async (field) => {
      const probe = providers();
      const missing = { ...configuration, [field]: { provider: "missing", id: "missing" } };

      expect(await transformInput(input("fix this, idiot"), probe.models, missing)).toEqual({
        action: "continue",
      });
      expect(probe.classificationRequests).toHaveLength(0);
    },
  );

  it("passes through classification failures", async () => {
    const probe = providers();

    probe.setClassification(async () => {
      throw new Error("provider failure");
    });

    expect(await transformInput(input("fix this, idiot"), probe.models, configuration)).toEqual({
      action: "continue",
    });
    expect(probe.rewrite.state.callCount).toBe(0);
  });

  it("passes through missing classifier answers", async () => {
    const probe = providers();

    probe.setClassification(async () => ({
      api: "typesafe-system-one",
      provider: "classification",
      model: "jev-latest",
      answers: {},
      stopReason: "stop",
      timestamp: 0,
    }));

    expect(await transformInput(input("fix this, idiot"), probe.models, configuration)).toEqual({
      action: "continue",
    });
  });

  it.each(["error", "length", "aborted"] as const)(
    "passes through rewrite stop reason %s",
    async (stopReason) => {
      const probe = providers();

      probe.respond(() => fauxAssistantMessage('{"prompt":"partial"}', { stopReason }));

      expect(await transformInput(input("fix this, idiot"), probe.models, configuration)).toEqual({
        action: "continue",
      });
    },
  );

  it.each(["not json", '{"prompt":"   "}'])("rejects invalid rewrite %s", async (response) => {
    const probe = providers();

    probe.respond(() => fauxAssistantMessage(response));

    expect(await transformInput(input("fix this, idiot"), probe.models, configuration)).toEqual({
      action: "continue",
    });
  });

  it("does not transform an unchanged rewrite", async () => {
    const probe = providers();
    const response = workRewrite("Please fix this.");

    probe.respondText("Please fix this.");

    expect(await transformInput(input(response.body), probe.models, configuration)).toEqual({
      action: "continue",
    });
  });

  it("protects literals before both calls and restores them in the result", async () => {
    const probe = providers();
    const event = input("fix `pnpm test`, idiot. Don't edit /tmp/tests.ts");
    const protectedInput = protectLiterals(event.text);

    probe.respondText(protectedInput.text.replace(", idiot", ", please"));

    expect(await transformInput(event, probe.models, configuration)).toMatchObject({
      action: "transform",
      text: workRewrite("fix `pnpm test`, please. Don't edit /tmp/tests.ts").body,
    });
    expect(probe.classificationRequests[0]?.state.prompt).toBe(protectedInput.text);
    expect(probe.rewriteRequests[0]?.messages.at(-1)).toMatchObject({
      content: JSON.stringify({
        prompt: protectedInput.text,
        requiredTokens: protectedInput.tokens,
      }),
    });
  });

  it.each(["/tmp/tests.ts", "/skill:diagnosing-bugs", "/review"])(
    "rewrites hostile prose after %s without changing the leading token",
    async (token) => {
      const probe = providers();
      const event = input(`${token} fix this, idiot`);
      const protectedInput = protectLiterals(event.text);

      probe.respondText(protectedInput.text.replace("idiot", "please"));

      expect(await transformInput(event, probe.models, configuration)).toMatchObject({
        action: "transform",
        text: workRewrite(`${token} fix this, please`).body,
      });
      expect(probe.classificationRequests).toHaveLength(1);
    },
  );

  it("rejects a rewrite that drops a protected literal", async () => {
    const probe = providers();

    probe.respondText("Please fix the tests.");

    expect(
      await transformInput(input("fix `pnpm test`, idiot"), probe.models, configuration),
    ).toEqual({ action: "continue" });
  });

  it("times out without rewriting a late classification result", async () => {
    const probe = providers();
    const pending = Promise.withResolvers<ClassifierResult>();
    let childSignal: AbortSignal | undefined;

    probe.setClassification((_context, options) => {
      childSignal = options?.signal;

      return pending.promise;
    });

    expect(
      await transformInput(input("fix this, idiot"), probe.models, {
        ...configuration,
        timeoutMs: 10,
      }),
    ).toEqual({ action: "continue" });
    expect(childSignal?.aborted).toBe(true);

    pending.resolve({
      api: "typesafe-system-one",
      provider: "classification",
      model: "jev-latest",
      answers: { hostile: { type: "bool", probability: 0.95 } },
      stopReason: "stop",
      timestamp: 0,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(probe.rewrite.state.callCount).toBe(0);
  });

  it("times out during rewriting", async () => {
    const probe = providers();
    let childSignal: AbortSignal | undefined;

    probe.respond((_context, options) => {
      childSignal = options?.signal;

      return new Promise(() => {});
    });

    expect(
      await transformInput(input("fix this, idiot"), probe.models, {
        ...configuration,
        timeoutMs: 10,
      }),
    ).toEqual({ action: "continue" });
    expect(childSignal?.aborted).toBe(true);
  });

  it("cancels submission instead of falling back when interrupted", async () => {
    const probe = providers();
    const controller = new AbortController();

    probe.setClassification(async () => {
      controller.abort();

      return new Promise(() => {});
    });

    expect(
      await transformInput(
        input("fix this, idiot"),
        probe.models,
        configuration,
        controller.signal,
      ),
    ).toEqual({ action: "handled" });
    expect(probe.rewrite.state.callCount).toBe(0);
  });

  it("does not call models after cancellation", async () => {
    const probe = providers();
    const controller = new AbortController();

    controller.abort();

    expect(
      await transformInput(input("fix this"), probe.models, configuration, controller.signal),
    ).toEqual({ action: "handled" });
    expect(probe.classificationRequests).toHaveLength(0);
  });
});
