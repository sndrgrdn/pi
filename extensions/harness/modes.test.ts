import { describe, expect, it } from "vitest";
import { describeModeCommand, pickInitialMode } from "./modes.ts";
import { BUILTIN_PROFILES, mergeProfiles } from "./profiles.ts";

// ── Initial Mode precedence (spec §2.5 persistence) ───────────────

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

	it("ignores values that are not a known Mode", () => {
		expect(pickInitialMode("ultra", "custom")).toBe("medium");
		expect(pickInitialMode(42, "high")).toBe("high");
	});
});

// ── /mode docs derive from live Profiles (§2.5) ───────────────────

describe("describeModeCommand", () => {
	it("documents the built-in route table per agent per Mode", () => {
		const docs = describeModeCommand(BUILTIN_PROFILES);
		expect(docs).toContain("Main: gpt-5.6-terra/low · gpt-5.6-sol/medium · gpt-5.6-sol/xhigh");
		expect(docs).toContain("Oracle: gpt-5.6-sol/high · gpt-5.6-sol/high · claude-fable-5/high");
		expect(docs).toContain("Task (per-call mode): gpt-5.6-sol/low · gpt-5.6-sol/high · claude-fable-5/high");
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
