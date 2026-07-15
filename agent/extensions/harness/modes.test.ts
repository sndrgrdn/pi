import { describe, expect, it } from "vitest";
import { modeSelectorIndex, parsePersistedMode } from "./modes.ts";

describe("parsePersistedMode", () => {
	it("accepts every persisted Mode state", () => {
		expect(parsePersistedMode('{"mode":"ultra"}')).toBe("ultra");
		expect(parsePersistedMode('{"mode":"custom"}')).toBe("custom");
	});

	it("rejects malformed or invalid persisted state", () => {
		expect(() => parsePersistedMode("{ nope")).toThrow();
		expect(() => parsePersistedMode("{}")).toThrow("Invalid Mode state: undefined");
		expect(() => parsePersistedMode('{"mode":null}')).toThrow("Invalid Mode state: null");
		expect(() => parsePersistedMode('{"mode":"extreme"}')).toThrow("Invalid Mode state: extreme");
	});
});

describe("modeSelectorIndex", () => {
	it("selects the active Mode in the fixed Mode order", () => {
		expect(modeSelectorIndex("high")).toBe(2);
		expect(modeSelectorIndex("ultra")).toBe(3);
	});

	it("selects medium when the active Mode is custom", () => {
		expect(modeSelectorIndex("custom")).toBe(1);
	});
});
