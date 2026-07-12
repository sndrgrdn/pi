import { describe, expect, it } from "vitest";
import { BackgroundShellRegistry } from "./registry.ts";
import { currentShellRegistry, withShellRegistry } from "./session-registry.ts";

describe("child shell registry binding", () => {
	it("makes the runner-owned registry available while child extensions load", async () => {
		const registry = new BackgroundShellRegistry();
		await withShellRegistry(registry, async () => {
			expect(currentShellRegistry()).toBe(registry);
		});
		expect(currentShellRegistry()).toBeUndefined();
	});

	it("keeps simultaneous child namespaces isolated from Main and each other", async () => {
		const main = new BackgroundShellRegistry();
		const first = new BackgroundShellRegistry();
		const second = new BackgroundShellRegistry();
		expect(currentShellRegistry()).toBeUndefined();
		await Promise.all([
			withShellRegistry(first, async () => expect(currentShellRegistry()).toBe(first)),
			withShellRegistry(second, async () => expect(currentShellRegistry()).toBe(second)),
		]);
		expect(currentShellRegistry()).not.toBe(main);
	});
});
