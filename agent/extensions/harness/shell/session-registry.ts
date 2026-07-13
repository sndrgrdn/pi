import { AsyncLocalStorage } from "node:async_hooks";
import type { BackgroundShellRegistry } from "./registry.ts";

const childRegistry = new AsyncLocalStorage<BackgroundShellRegistry>();

/** Bind a runner-owned process namespace while pi loads the child extensions. */
export function withShellRegistry<T>(registry: BackgroundShellRegistry, create: () => Promise<T>): Promise<T> {
	return childRegistry.run(registry, create);
}

export function currentShellRegistry(): BackgroundShellRegistry | undefined {
	return childRegistry.getStore();
}
