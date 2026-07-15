import { describe, expect, it } from "vitest";
import { describeModeCommand, modeSelectorIndex, parsePersistedMode, pickInitialMode } from "./modes.ts";
import { BUILTIN_PROFILES, mergeProfiles } from "./profiles.ts";

// ── Initial Mode precedence ──────────────────────────────────────

describe("pickInitialMode", () => {
	it("prefers the session-recorded Mode (resume restores its Mode)", () => {
		expect(pickInitialMode("high", "low")).toBe("high");
	});

	it("falls back to the global Mode when the session has none", () => {
		expect(pickInitialMode(undefined, "low")).toBe("low");
	});

	it("preserves an explicit null Mode from the session or global setting", () => {
		expect(pickInitialMode(null, "high")).toBeNull();
		expect(pickInitialMode(undefined, null)).toBeNull();
	});

	it("defaults to medium when nothing is recorded", () => {
		expect(pickInitialMode(undefined, undefined)).toBe("medium");
	});

	it("accepts ultra and rejects invalid persisted state", () => {
		expect(pickInitialMode("ultra", "high")).toBe("ultra");
		expect(() => pickInitialMode("extreme", "high")).toThrow("Invalid Mode state: extreme");
		expect(() => pickInitialMode(undefined, 42)).toThrow("Invalid Mode state: 42");
	});
});

describe("parsePersistedMode", () => {
	it("accepts every persisted Mode state", () => {
		expect(parsePersistedMode('{"mode":"ultra"}')).toBe("ultra");
		expect(parsePersistedMode('{"mode":null}')).toBeNull();
	});

	it("rejects malformed or invalid persisted state", () => {
		expect(() => parsePersistedMode("{ nope")).toThrow();
		expect(() => parsePersistedMode("{}")).toThrow("Invalid Mode state: undefined");
		expect(() => parsePersistedMode('{"mode":"extreme"}')).toThrow("Invalid Mode state: extreme");
	});
});

describe("modeSelectorIndex", () => {
	it("selects the active Mode in the fixed Mode order", () => {
		expect(modeSelectorIndex("high")).toBe(2);
		expect(modeSelectorIndex("ultra")).toBe(3);
	});

	it("selects medium when the active Mode is custom", () => {
		expect(modeSelectorIndex(null)).toBe(1);
	});
});

// ── /mode docs derive from live Profiles ─────────────────────────

describe("describeModeCommand", () => {
	it("documents the built-in route table per agent per Mode", () => {
		const docs = describeModeCommand(BUILTIN_PROFILES);
		expect(docs).toContain("Main: gpt-5.6-terra/low · gpt-5.6-sol/medium · gpt-5.6-sol/xhigh · claude-fable-5/high");
		expect(docs).toContain("Oracle: gpt-5.6-sol/high · gpt-5.6-sol/high · claude-fable-5/high · gpt-5.6-sol/high");
		expect(docs).toContain(
			"Task (per-call mode): gpt-5.6-sol/low · gpt-5.6-sol/high · gpt-5.6-sol/high · claude-fable-5/high",
		);
		expect(docs).toContain("Finder: claude-haiku-4-5/minimal");
		expect(docs).toContain("Librarian: gpt-5.6-sol/off");
	});

	it("reflects profiles.json overrides instead of going stale", () => {
		const merged = mergeProfiles(BUILTIN_PROFILES, {
			modes: { high: { model: "anthropic/claude-opus-4-6" } },
			agents: { finder: { reasoning: "low" } },
		});
		const docs = describeModeCommand(merged);
		expect(docs).toContain("claude-opus-4-6/xhigh");
		expect(docs).toContain("Finder: claude-haiku-4-5/low");
	});
});
