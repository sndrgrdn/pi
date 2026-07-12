/**
 * Profiles — built-in resolved bundles + profiles.json load/validate/merge
 * (spec §2.2–§2.3, §8; synthesis decision §9.1).
 *
 * A Profile is an internal resolved bundle: model, reasoning, and posture per
 * Mode for Main, plus per-agent routes. Route tables for Mode-dependent
 * agents (Oracle, Task) live here, not in the agent registry. The optional
 * global `~/.pi/agent/profiles.json` is a strict two-section partial
 * override; validation failures are loud and precise, with no fallback.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type Mode = "low" | "medium" | "high";
export const MODES = ["low", "medium", "high"] as const satisfies readonly Mode[];
export const DEFAULT_MODE: Mode = "medium";

export type ReasoningLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
const REASONING_LEVELS: readonly string[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

/** A resolved `{model, reasoning}` pair handed to pi / the subagent runner. */
export interface Route {
	/** `provider/model-id`, e.g. `openai-codex/gpt-5.6-sol`. */
	model: string;
	reasoning: ReasoningLevel;
}

/** Main's per-Mode bundle: route + posture prompt block (§2.4). */
export interface ModeProfile extends Route {
	posture: string;
}

/** Mode-dependent agents route per Mode; Mode-invariant agents are flat. */
export type AgentKey = "finder" | "librarian" | "oracle" | "task";

export interface ResolvedProfiles {
	modes: Record<Mode, ModeProfile>;
	agents: {
		finder: Route;
		librarian: Route;
		oracle: Record<Mode, Route>;
		task: Record<Mode, Route>;
	};
}

// ── Built-in defaults (route summary §8) ──────────────────────────

const TERRA = "openai-codex/gpt-5.6-terra";
const SOL = "openai-codex/gpt-5.6-sol";
const FABLE = "anthropic/claude-fable-5";
const HAIKU = "anthropic/claude-haiku-4-5";

const PROMPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "agents", "prompts");

function readPrompt(name: string): string {
	return readFileSync(join(PROMPTS_DIR, name), "utf8").trim();
}

/** Posture blocks tune depth/initiative/verification only (§2.4). */
export const POSTURES: Record<Mode, string> = {
	low: readPrompt("posture-low.md"),
	medium: readPrompt("posture-medium.md"),
	high: readPrompt("posture-high.md"),
};

/** Task posture block, appended to Task child prompts (§9.4). */
export const TASK_POSTURE = readPrompt("task-posture.md");

export const BUILTIN_PROFILES: ResolvedProfiles = {
	modes: {
		low: { model: TERRA, reasoning: "low", posture: POSTURES.low },
		medium: { model: SOL, reasoning: "medium", posture: POSTURES.medium },
		high: { model: SOL, reasoning: "xhigh", posture: POSTURES.high },
	},
	agents: {
		finder: { model: HAIKU, reasoning: "minimal" },
		librarian: { model: SOL, reasoning: "off" },
		oracle: {
			low: { model: SOL, reasoning: "high" },
			medium: { model: SOL, reasoning: "high" },
			high: { model: FABLE, reasoning: "high" },
		},
		task: {
			low: { model: SOL, reasoning: "low" },
			medium: { model: SOL, reasoning: "high" },
			high: { model: FABLE, reasoning: "high" },
		},
	},
};

// ── Route resolution ──────────────────────────────────────────────

/** Main's route for a Mode (§2.1). */
export function resolveMainRoute(profiles: ResolvedProfiles, mode: Mode): Route {
	const { model, reasoning } = profiles.modes[mode];
	return { model, reasoning };
}

/**
 * An agent's route. Finder/Librarian are Mode-invariant; Oracle routes from
 * the parent's Mode, Task from its per-call `mode` param (§8).
 */
export function resolveAgentRoute(profiles: ResolvedProfiles, agent: AgentKey, mode: Mode): Route {
	const entry = profiles.agents[agent];
	return agent === "oracle" || agent === "task"
		? (entry as Record<Mode, Route>)[mode]
		: (entry as Route);
}

// ── profiles.json validation (§2.3) ───────────────────────────────

/** Partial override shape accepted from profiles.json. */
export interface RouteOverride {
	model?: string;
	reasoning?: ReasoningLevel;
}

export interface ModeOverride extends RouteOverride {
	posture?: string;
}

export interface ProfilesOverride {
	modes?: Partial<Record<Mode, ModeOverride>>;
	agents?: {
		finder?: RouteOverride;
		librarian?: RouteOverride;
		oracle?: Partial<Record<Mode, RouteOverride>>;
		task?: Partial<Record<Mode, RouteOverride>>;
	};
}

const AGENT_KEYS: readonly AgentKey[] = ["finder", "librarian", "oracle", "task"];
const PER_ROUTE_AGENTS: readonly AgentKey[] = ["oracle", "task"];

// Shape-level model id check: `provider/model-id`. Whether the model actually
// exists/authenticates is resolved live via pi's registry and setModel (§2.3:
// no fallback machinery; pi natively owns provider failures).
const MODEL_ID_RE = /^[^\s/]+\/[^\s/][^\s]*$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Strictly validate a parsed profiles.json. Collects every problem so one
 * fix pass suffices; throws a single Error listing all of them.
 */
export function validateProfilesOverride(raw: unknown): ProfilesOverride {
	const errors: string[] = [];
	const fail = (path: string, why: string) => errors.push(`${path}: ${why}`);

	const checkRouteFields = (
		path: string,
		value: unknown,
		allowed: readonly string[],
	): void => {
		if (!isPlainObject(value)) {
			fail(path, "expected an object");
			return;
		}
		for (const [field, fieldValue] of Object.entries(value)) {
			if (!allowed.includes(field)) {
				fail(path, `unknown field "${field}" (expected ${allowed.join(", ")})`);
			} else if (field === "model") {
				if (typeof fieldValue !== "string" || !MODEL_ID_RE.test(fieldValue)) {
					fail(`${path}.model`, `invalid model id ${JSON.stringify(fieldValue)} (expected "provider/model-id")`);
				}
			} else if (field === "reasoning") {
				if (typeof fieldValue !== "string" || !REASONING_LEVELS.includes(fieldValue)) {
					fail(
						`${path}.reasoning`,
						`invalid reasoning level ${JSON.stringify(fieldValue)} (expected ${REASONING_LEVELS.join(", ")})`,
					);
				}
			} else if (field === "posture" && typeof fieldValue !== "string") {
				fail(`${path}.posture`, "expected a string");
			}
		}
	};

	if (!isPlainObject(raw)) {
		throw new Error("Invalid profiles.json: expected an object at the top level");
	}

	for (const key of Object.keys(raw)) {
		if (key !== "modes" && key !== "agents") {
			fail("profiles.json", `unknown section "${key}" (expected "modes", "agents")`);
		}
	}

	if (raw.modes !== undefined) {
		if (!isPlainObject(raw.modes)) {
			fail("modes", "expected an object");
		} else {
			for (const [mode, value] of Object.entries(raw.modes)) {
				if (!(MODES as readonly string[]).includes(mode)) {
					fail("modes", `unknown Mode "${mode}" (expected ${MODES.join(", ")})`);
				} else {
					checkRouteFields(`modes.${mode}`, value, ["model", "reasoning", "posture"]);
				}
			}
		}
	}

	if (raw.agents !== undefined) {
		if (!isPlainObject(raw.agents)) {
			fail("agents", "expected an object");
		} else {
			for (const [agent, value] of Object.entries(raw.agents)) {
				if (!(AGENT_KEYS as readonly string[]).includes(agent)) {
					fail("agents", `unknown agent "${agent}" (expected ${AGENT_KEYS.join(", ")})`);
				} else if (PER_ROUTE_AGENTS.includes(agent as AgentKey)) {
					if (!isPlainObject(value)) {
						fail(`agents.${agent}`, "expected an object");
					} else {
						for (const [route, routeValue] of Object.entries(value)) {
							if (!(MODES as readonly string[]).includes(route)) {
								fail(`agents.${agent}`, `unknown route "${route}" (expected ${MODES.join(", ")})`);
							} else {
								checkRouteFields(`agents.${agent}.${route}`, routeValue, ["model", "reasoning"]);
							}
						}
					}
				} else {
					checkRouteFields(`agents.${agent}`, value, ["model", "reasoning"]);
				}
			}
		}
	}

	if (errors.length > 0) {
		throw new Error(`Invalid profiles.json:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
	}
	return raw as ProfilesOverride;
}

// ── Merge (partial override over built-in defaults) ───────────────

function mergeRoute<T extends Route>(base: T, override: RouteOverride | ModeOverride | undefined): T {
	return override ? { ...base, ...override } : { ...base };
}

function mergePerRoute(
	base: Record<Mode, Route>,
	override: Partial<Record<Mode, RouteOverride>> | undefined,
): Record<Mode, Route> {
	return {
		low: mergeRoute(base.low, override?.low),
		medium: mergeRoute(base.medium, override?.medium),
		high: mergeRoute(base.high, override?.high),
	};
}

/** Field-level merge of a validated override over the built-in defaults. */
export function mergeProfiles(base: ResolvedProfiles, override: ProfilesOverride): ResolvedProfiles {
	return {
		modes: {
			low: mergeRoute(base.modes.low, override.modes?.low),
			medium: mergeRoute(base.modes.medium, override.modes?.medium),
			high: mergeRoute(base.modes.high, override.modes?.high),
		},
		agents: {
			finder: mergeRoute(base.agents.finder, override.agents?.finder),
			librarian: mergeRoute(base.agents.librarian, override.agents?.librarian),
			oracle: mergePerRoute(base.agents.oracle, override.agents?.oracle),
			task: mergePerRoute(base.agents.task, override.agents?.task),
		},
	};
}

// ── Posture selection (§2.4) ──────────────────────────────────────

/** The posture block appended to the system prompt for the active Mode. */
export function selectPosture(profiles: ResolvedProfiles, mode: Mode): string {
	return profiles.modes[mode].posture;
}

// ── Load (startup seam) ───────────────────────────────────────────

/**
 * Load resolved Profiles: built-in defaults, optionally overridden by a
 * global profiles.json. Missing file → defaults. Malformed or invalid file →
 * loud Error naming the file; no fallback (§2.3).
 */
export function loadProfiles(filePath: string): ResolvedProfiles {
	if (!existsSync(filePath)) return structuredClone(BUILTIN_PROFILES);
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(filePath, "utf8"));
	} catch (err) {
		throw new Error(`Invalid profiles.json (${filePath}): ${err instanceof Error ? err.message : String(err)}`);
	}
	return mergeProfiles(BUILTIN_PROFILES, validateProfilesOverride(parsed));
}
