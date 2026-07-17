import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	BUILTIN_PROFILES,
	loadProfiles,
	mergeProfiles,
	validateProfilesOverride,
} from "./profiles.ts";

const SOL = "openai-codex/gpt-5.6-sol";
const HAIKU = "anthropic/claude-haiku-4-5";

describe("agent routes", () => {
	it("gives each fixed specialist one route", () => {
		expect(BUILTIN_PROFILES.agents.finder).toEqual({ model: HAIKU, reasoning: "minimal" });
		expect(BUILTIN_PROFILES.agents.librarian).toEqual({ model: SOL, reasoning: "off" });
		expect(BUILTIN_PROFILES.agents.oracle).toEqual({ model: SOL, reasoning: "high" });
	});

	it("gives Task standard and high effort routes", () => {
		expect(BUILTIN_PROFILES.agents.task.standard).toEqual({ model: SOL, reasoning: "low" });
		expect(BUILTIN_PROFILES.agents.task.high).toEqual({ model: SOL, reasoning: "high" });
	});
});

describe("validateProfilesOverride", () => {
	it("accepts partial agent-shaped overrides", () => {
		const raw = {
			agents: {
				finder: { model: "anthropic/claude-haiku-4-5" },
				oracle: { reasoning: "xhigh" },
				task: { high: { model: "anthropic/claude-fable-5" } },
			},
		};
		expect(validateProfilesOverride(raw)).toEqual(raw);
	});

	it("rejects invalid external input at startup", () => {
		expect(() => validateProfilesOverride([])).toThrow(/expected an object/);
		expect(() => validateProfilesOverride({ modes: {} })).toThrow(/unknown section "modes"/);
		expect(() => validateProfilesOverride({ agents: { builder: {} } })).toThrow(/unknown agent "builder"/);
		expect(() => validateProfilesOverride({ agents: { task: { medium: {} } } })).toThrow(/unknown effort "medium"/);
		expect(() => validateProfilesOverride({ agents: { oracle: { model: "no-slash" } } })).toThrow(/invalid model id/);
		expect(() => validateProfilesOverride({ agents: { task: { high: { reasoning: "max" } } } })).toThrow(
			/invalid reasoning level/,
		);
	});
});

describe("mergeProfiles", () => {
	it("merges route fields without mutating defaults", () => {
		const before = structuredClone(BUILTIN_PROFILES);
		const merged = mergeProfiles(BUILTIN_PROFILES, {
			agents: {
				finder: { reasoning: "low" },
				oracle: { model: "anthropic/claude-fable-5" },
				task: { high: { reasoning: "xhigh" } },
			},
		});

		expect(merged.agents.finder).toEqual({ model: HAIKU, reasoning: "low" });
		expect(merged.agents.oracle).toEqual({
			model: "anthropic/claude-fable-5",
			reasoning: "high",
		});
		expect(merged.agents.task.high).toEqual({ model: SOL, reasoning: "xhigh" });
		expect(merged.agents.task.standard).toEqual(BUILTIN_PROFILES.agents.task.standard);
		expect(BUILTIN_PROFILES).toEqual(before);
	});
});

describe("loadProfiles", () => {
	let dir: string | undefined;
	afterEach(() => {
		if (dir) rmSync(dir, { recursive: true, force: true });
		dir = undefined;
	});

	const write = (content: string): string => {
		dir = mkdtempSync(join(tmpdir(), "profiles-test-"));
		const path = join(dir, "profiles.json");
		writeFileSync(path, content);
		return path;
	};

	it("returns built-in defaults when the file is absent", () => {
		expect(loadProfiles("/nonexistent/profiles.json")).toEqual(BUILTIN_PROFILES);
	});

	it("loads a partial override", () => {
		const path = write(JSON.stringify({ agents: { task: { high: { reasoning: "xhigh" } } } }));
		expect(loadProfiles(path).agents.task.high).toEqual({ model: SOL, reasoning: "xhigh" });
	});

	it("fails loudly on malformed JSON, naming the file", () => {
		const path = write("{ nope");
		expect(() => loadProfiles(path)).toThrow(path);
	});
});
