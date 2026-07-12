import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { decorateTopBorder, describeModeCommand, pickInitialMode } from "./modes.ts";
import { BUILTIN_PROFILES, mergeProfiles } from "./profiles.ts";

// ── Border decoration (spec §2.5: Mode right-aligned in top border) ──

describe("decorateTopBorder", () => {
	it("inserts the Mode label right-aligned before the closing corner", () => {
		const line = `╭${"─".repeat(30)}╮`;
		const out = decorateTopBorder(line, "medium");
		expect(out).toMatch(/ medium ─╮$/);
		expect(visibleWidth(out)).toBe(visibleWidth(line));
	});

	it("keeps an existing right corner label, appending the Mode after it", () => {
		const line = `╭${"─".repeat(30)} Sol · med ─╮`;
		const out = decorateTopBorder(line, "high");
		expect(out).toMatch(/ Sol · med ─ high ─╮$/);
		expect(visibleWidth(out)).toBe(visibleWidth(line));
	});

	it("preserves ANSI styling and visible width", () => {
		const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;
		const line = `${dim(`╭${"─".repeat(30)}`)} label ${dim("─╮")}`;
		const out = decorateTopBorder(line, "low");
		expect(out).toContain("\x1b[2m");
		expect(out).toMatch(/ low /);
		expect(visibleWidth(out)).toBe(visibleWidth(line));
	});

	it("styles the label when a style function is given, width still constant", () => {
		const line = `╭${"─".repeat(30)}╮`;
		const out = decorateTopBorder(line, "high", (s) => `\x1b[35m${s}\x1b[39m`);
		expect(out).toContain("\x1b[35mhigh\x1b[39m");
		expect(visibleWidth(out)).toBe(visibleWidth(line));
	});

	it("leaves the line unchanged when there is no room", () => {
		const line = "╭────╮";
		expect(decorateTopBorder(line, "medium")).toBe(line);
	});

	it("leaves non-border lines unchanged", () => {
		expect(decorateTopBorder("plain text", "medium")).toBe("plain text");
	});
});

// ── Initial Mode precedence (spec §2.5 persistence) ───────────────

describe("pickInitialMode", () => {
	it("prefers the session-recorded Mode (resume restores its Mode)", () => {
		expect(pickInitialMode("high", "low")).toBe("high");
	});

	it("falls back to the global Mode when the session has none", () => {
		expect(pickInitialMode(undefined, "low")).toBe("low");
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
