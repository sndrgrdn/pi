/**
 * Caps every model's context window at CONTEXT_WINDOW_CAP.
 *
 * The factory only receives `pi` (no model registry at load time), so the
 * cap is applied by re-registering providers at `session_start`, before the
 * first turn. Known limits: `pi --list-models` shows uncapped windows;
 * `modelOverrides` in models.json compose last and outrank this cap.
 */

import type { ExtensionAPI, ModelRegistry, ProviderConfig } from "@earendil-works/pi-coding-agent";
import type { Provider } from "@earendil-works/pi-ai";
import { Effect } from "effect";

/** Context window cap in tokens. */
export const CONTEXT_WINDOW_CAP = 250_000;

/**
 * String marker, not a Symbol: `/reload` re-imports this module, so a fresh
 * Symbol would fail to detect a wrap performed by the previous module
 * instance and double-wrap.
 */
const CAPPED_MARKER = "__piCapContextWindowCapped";

type CappedProvider = Provider & { [CAPPED_MARKER]?: true };

// SAFETY: Provider is structural and cannot express the private CAPPED_MARKER
// brand; only these two helpers read/write it, and markCapped runs only on the
// freshly wrapped object produced by capModelContextWindow.
const isCapped = (p: Provider): boolean => (p as CappedProvider)[CAPPED_MARKER] === true;

const markCapped = (p: Provider): void => {
  // SAFETY: Only these helpers access the private marker, and this receives a freshly wrapped provider.
  (p as CappedProvider)[CAPPED_MARKER] = true;
};

/** Returns the model with contextWindow capped at CONTEXT_WINDOW_CAP; never mutates the input. */
export const capModelContextWindow = <T extends { id: string; contextWindow?: number }>(
  model: T,
): T =>
  model.contextWindow === undefined
    ? model
    : model.contextWindow <= CONTEXT_WINDOW_CAP
      ? model
      : { ...model, contextWindow: CONTEXT_WINDOW_CAP };

/** Wraps getModels() so every result is capped; idempotent per provider object. */
export const capProviderContextWindows = (provider: Provider): Provider => {
  if (isCapped(provider)) return provider;

  const wrapped: Provider = {
    ...provider,
    getModels: () => provider.getModels().map(capModelContextWindow),
  };

  markCapped(wrapped);

  return wrapped;
};

/** Narrow ModelRegistry slice so tests can fake it. */
export interface ContextWindowCapLookup {
  getRegisteredProviderConfig(id: string): ProviderConfig | undefined;
  getProvider(id: string): Provider | undefined;
}

/** Narrow ExtensionAPI slice so tests can fake it. */
export interface ContextWindowCapRegistrar {
  registerProvider(provider: Provider): void;
  registerProvider(id: string, config: ProviderConfig): void;
}

/** The action that caps one provider's models: wrap the provider object or re-register its config. */
export type ContextWindowCapAction =
  | { kind: "wrapProvider"; provider: Provider }
  | { kind: "registerConfig"; id: string; config: ProviderConfig };

const needsContextWindowCap = (models: readonly { contextWindow?: number }[]): boolean =>
  models.some(
    (model) => model.contextWindow !== undefined && model.contextWindow > CONTEXT_WINDOW_CAP,
  );

/** Pure decision: the action that caps a provider's models, or undefined when none need it. */
export const contextWindowCapAction = (
  lookup: ContextWindowCapLookup,
  id: string,
): ContextWindowCapAction | undefined => {
  const config = lookup.getRegisteredProviderConfig(id);

  if (config) {
    // Config-style: the composer re-applies the raw config above any wrapped
    // base, so re-register it with the cap applied. Judge need from the
    // original models: an exactly-at-cap model would read as "no cap needed".
    const baseModels = config.models ?? [...(lookup.getProvider(id)?.getModels() ?? [])];

    if (!needsContextWindowCap(baseModels)) return undefined;
    const models = baseModels.map(capModelContextWindow);
    const refreshModels = config.refreshModels;
    const cappedConfig: ProviderConfig = { ...config, models };

    if (refreshModels) {
      cappedConfig.refreshModels = async (context) =>
        (await refreshModels(context)).map(capModelContextWindow);
    }

    return { kind: "registerConfig", id, config: cappedConfig };
  }

  // Built-in: wrap the provider; the composer re-reads base.getModels() on
  // every call, so refreshed catalogs stay capped.
  const provider = lookup.getProvider(id);

  if (!provider || !needsContextWindowCap(provider.getModels())) return undefined;

  return { kind: "wrapProvider", provider };
};

const applyContextWindowCap = (
  registrar: ContextWindowCapRegistrar,
  action: ContextWindowCapAction,
): void => {
  if (action.kind === "wrapProvider") {
    registrar.registerProvider(capProviderContextWindows(action.provider));
  } else {
    registrar.registerProvider(action.id, action.config);
  }
};

/** Exported so the registry path is testable without a pi runtime. */
export const capOneProviderSync = (
  registrar: ContextWindowCapRegistrar,
  lookup: ContextWindowCapLookup,
  id: string,
): void => {
  const action = contextWindowCapAction(lookup, id);

  if (action) applyContextWindowCap(registrar, action);
};

const applyContextWindowCaps = Effect.fn("CapContextWindow.capAllProviders")(function* (
  pi: ExtensionAPI,
  registry: ModelRegistry,
) {
  const ids = new Set<string>([
    ...registry.getAll().map((model) => model.provider),
    ...registry.getRegisteredProviderIds(),
  ]);

  for (const id of ids) {
    // Log defects and continue; one bad provider must not abort the rest.
    yield* Effect.sync(() => capOneProviderSync(pi, registry, id)).pipe(
      Effect.catchDefect((cause) =>
        Effect.sync(() => console.warn(`context-window-cap: ${id}: ${String(cause)}`)),
      ),
    );
  }
});

/** Re-apply the context-window cap to every over-cap provider at session_start. */
export default function capContextWindow(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    void Effect.runFork(applyContextWindowCaps(pi, ctx.modelRegistry));
  });
}
