import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	BUILTIN_PROFILES,
	loadProfiles,
	MODES,
	mergeProfiles,
	resolveAgentRoute,
	resolveMainRoute,
	validateProfilesOverride,
} from "./profiles.ts";

const TERRA = "openai-codex/gpt-5.6-terra";
const SOL = "openai-codex/gpt-5.6-sol";
const FABLE = "anthropic/claude-fable-5";
const HAIKU = "anthropic/claude-haiku-4-5";

// ── Route resolution ──────────────────────────────────────────────

describe("route resolution", () => {
	it("scales Main's model and reasoning effort with the selected Mode", () => {
		expect(resolveMainRoute(BUILTIN_PROFILES, "low")).toEqual({ model: TERRA, reasoning: "low" });
		expect(resolveMainRoute(BUILTIN_PROFILES, "medium")).toEqual({ model: SOL, reasoning: "medium" });
		expect(resolveMainRoute(BUILTIN_PROFILES, "high")).toEqual({ model: SOL, reasoning: "xhigh" });
		expect(resolveMainRoute(BUILTIN_PROFILES, "ultra")).toEqual({ model: FABLE, reasoning: "high" });
	});

	it("keeps Finder lightweight regardless of the selected Mode", () => {
		for (const mode of MODES) {
			expect(resolveAgentRoute(BUILTIN_PROFILES, "finder", mode)).toEqual({
				model: HAIKU,
				reasoning: "minimal",
			});
		}
	});

	it("keeps Librarian on its research route regardless of the selected Mode", () => {
		for (const mode of MODES) {
			expect(resolveAgentRoute(BUILTIN_PROFILES, "librarian", mode)).toEqual({
				model: SOL,
				reasoning: "off",
			});
		}
	});

	it("gives Oracle the strongest route in high Mode", () => {
		expect(resolveAgentRoute(BUILTIN_PROFILES, "oracle", "low")).toEqual({ model: SOL, reasoning: "high" });
		expect(resolveAgentRoute(BUILTIN_PROFILES, "oracle", "medium")).toEqual({ model: SOL, reasoning: "high" });
		expect(resolveAgentRoute(BUILTIN_PROFILES, "oracle", "high")).toEqual({ model: FABLE, reasoning: "high" });
		expect(resolveAgentRoute(BUILTIN_PROFILES, "oracle", "ultra")).toEqual({ model: SOL, reasoning: "high" });
	});

	it("scales delegated tasks with their per-call Mode", () => {
		expect(resolveAgentRoute(BUILTIN_PROFILES, "task", "low")).toEqual({ model: SOL, reasoning: "low" });
		expect(resolveAgentRoute(BUILTIN_PROFILES, "task", "medium")).toEqual({ model: SOL, reasoning: "high" });
		expect(resolveAgentRoute(BUILTIN_PROFILES, "task", "high")).toEqual({ model: SOL, reasoning: "high" });
		expect(resolveAgentRoute(BUILTIN_PROFILES, "task", "ultra")).toEqual({ model: FABLE, reasoning: "high" });
	});
});

// ── profiles.json validation matrix ───────────────────────────────

describe("validateProfilesOverride", () => {
	it("accepts an empty object and both empty sections", () => {
		expect(validateProfilesOverride({})).toEqual({});
		expect(validateProfilesOverride({ modes: {}, agents: {} })).toEqual({ modes: {}, agents: {} });
	});

	it("accepts a valid partial override", () => {
		const raw = {
			modes: { ultra: { model: "anthropic/claude-fable-5", reasoning: "high" } },
			agents: {
				finder: { model: "anthropic/claude-haiku-4-5" },
				oracle: { high: { reasoning: "xhigh" } },
			},
		};
		expect(validateProfilesOverride(raw)).toEqual(raw);
	});

	it("rejects a non-object root", () => {
		expect(() => validateProfilesOverride([])).toThrow(/expected an object/);
		expect(() => validateProfilesOverride("nope")).toThrow(/expected an object/);
	});

	it("rejects unknown top-level sections", () => {
		expect(() => validateProfilesOverride({ routes: {} })).toThrow(
			/unknown section "routes" \(expected "modes", "agents"\)/,
		);
	});

	it("rejects unknown Mode keys — no extra Modes", () => {
		expect(() => validateProfilesOverride({ modes: { extreme: {} } })).toThrow(
			/modes: unknown Mode "extreme" \(expected low, medium, high, ultra\)/,
		);
		expect(() => validateProfilesOverride({ modes: { custom: {} } })).toThrow(
			/modes: unknown Mode "custom" \(expected low, medium, high, ultra\)/,
		);
	});

	it("rejects unknown agent keys", () => {
		expect(() => validateProfilesOverride({ agents: { builder: {} } })).toThrow(
			/agents: unknown agent "builder" \(expected finder, librarian, oracle, task\)/,
		);
	});

	it("rejects unknown fields in a mode override", () => {
		expect(() => validateProfilesOverride({ modes: { high: { tools: [] } } })).toThrow(
			/modes\.high: unknown field "tools" \(expected model, reasoning\)/,
		);
	});

	it("rejects removed posture overrides", () => {
		expect(() => validateProfilesOverride({ modes: { high: { posture: "x" } } })).toThrow(
			/modes\.high: unknown field "posture" \(expected model, reasoning\)/,
		);
		expect(() => validateProfilesOverride({ agents: { finder: { posture: "x" } } })).toThrow(
			/agents\.finder: unknown field "posture" \(expected model, reasoning\)/,
		);
		expect(() => validateProfilesOverride({ agents: { task: { low: { posture: "x" } } } })).toThrow(
			/agents\.task\.low: unknown field "posture" \(expected model, reasoning\)/,
		);
	});

	it("rejects flat model/reasoning on per-route agents", () => {
		expect(() => validateProfilesOverride({ agents: { oracle: { model: "a/b" } } })).toThrow(
			/agents\.oracle: unknown route "model" \(expected low, medium, high, ultra\)/,
		);
	});

	it("rejects route keys on flat agents", () => {
		expect(() => validateProfilesOverride({ agents: { librarian: { low: { model: "a/b" } } } })).toThrow(
			/agents\.librarian: unknown field "low" \(expected model, reasoning\)/,
		);
	});

	it("rejects bad model ids", () => {
		expect(() => validateProfilesOverride({ modes: { low: { model: "no-slash" } } })).toThrow(
			/modes\.low\.model: invalid model id "no-slash" \(expected "provider\/model-id"\)/,
		);
		expect(() => validateProfilesOverride({ agents: { finder: { model: 42 } } })).toThrow(
			/agents\.finder\.model: invalid model id 42/,
		);
	});

	it("rejects bad reasoning levels", () => {
		expect(() => validateProfilesOverride({ modes: { medium: { reasoning: "ultra" } } })).toThrow(
			/modes\.medium\.reasoning: invalid reasoning level "ultra" \(expected off, minimal, low, medium, high, xhigh\)/,
		);
	});

	it("collects all errors so one fix pass suffices", () => {
		let message = "";
		try {
			validateProfilesOverride({
				modes: { extreme: {}, low: { model: "bad" } },
				agents: { builder: {} },
			});
		} catch (err) {
			message = (err as Error).message;
		}
		expect(message).toMatch(/unknown Mode "extreme"/);
		expect(message).toMatch(/modes\.low\.model: invalid model id "bad"/);
		expect(message).toMatch(/unknown agent "builder"/);
	});
});

// ── Merge semantics (partial override over defaults) ──────────────

describe("mergeProfiles", () => {
	it("returns defaults untouched for an empty override", () => {
		expect(mergeProfiles(BUILTIN_PROFILES, {})).toEqual(BUILTIN_PROFILES);
	});

	it("changes only the selected Mode's route", () => {
		const merged = mergeProfiles(BUILTIN_PROFILES, {
			modes: { high: { model: "anthropic/claude-fable-5" } },
		});
		expect(merged.modes.high.model).toBe("anthropic/claude-fable-5");
		expect(resolveMainRoute(merged, "high")).toEqual({ model: FABLE, reasoning: "xhigh" });
		expect(resolveMainRoute(merged, "low")).toEqual(resolveMainRoute(BUILTIN_PROFILES, "low"));
	});

	it("overrides flat agents and per-route agents independently", () => {
		const merged = mergeProfiles(BUILTIN_PROFILES, {
			agents: {
				finder: { reasoning: "low" },
				task: { high: { model: "anthropic/claude-opus-4-6" } },
			},
		});
		// a flat override is Mode-invariant: it applies under every Mode
		for (const mode of MODES) {
			expect(resolveAgentRoute(merged, "finder", mode)).toEqual({
				model: HAIKU,
				reasoning: "low",
			});
		}
		expect(resolveAgentRoute(merged, "task", "high")).toEqual({
			model: "anthropic/claude-opus-4-6",
			reasoning: "high",
		});
		expect(resolveAgentRoute(merged, "task", "low")).toEqual(resolveAgentRoute(BUILTIN_PROFILES, "task", "low"));
		expect(merged.agents.oracle).toEqual(BUILTIN_PROFILES.agents.oracle);
	});

	it("does not mutate the defaults", () => {
		const before = structuredClone(BUILTIN_PROFILES);
		mergeProfiles(BUILTIN_PROFILES, { modes: { low: { model: "a/b" } } });
		expect(BUILTIN_PROFILES).toEqual(before);
	});
});

// ── loadProfiles (file seam) ──────────────────────────────────────

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

	it("merges a valid partial override over the defaults", () => {
		const path = write(JSON.stringify({ modes: { high: { reasoning: "high" } } }));
		const profiles = loadProfiles(path);
		expect(profiles.modes.high.reasoning).toBe("high");
		expect(profiles.modes.high.model).toBe(BUILTIN_PROFILES.modes.high.model);
	});

	it("fails loudly on malformed JSON, naming the file", () => {
		const path = write("{ nope");
		expect(() => loadProfiles(path)).toThrow(/Invalid profiles\.json/);
		expect(() => loadProfiles(path)).toThrow(path);
	});

	it("fails loudly on an invalid override", () => {
		const path = write(JSON.stringify({ modes: { extreme: {} } }));
		expect(() => loadProfiles(path)).toThrow(/unknown Mode "extreme"/);
	});
});
