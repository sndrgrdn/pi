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
});
