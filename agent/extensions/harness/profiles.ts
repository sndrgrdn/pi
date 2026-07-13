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

/** Type guard: is `value` one of the three fixed Modes? */
export function isMode(value: unknown): value is Mode {
	return typeof value === "string" && (MODES as readonly string[]).includes(value);
}

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

export type AgentKey = "finder" | "librarian" | "oracle" | "task";

/**
 * Resolved bundles. Agents are uniformly `Record<Mode, Route>`: Mode-invariant
 * agents (Finder, Librarian) simply carry the same route under every Mode —
 * the flat-vs-per-route distinction is a profiles.json schema fact (§9.1),
 * not a resolved-bundle fact.
 */
export interface ResolvedProfiles {
	modes: Record<Mode, ModeProfile>;
	agents: Record<AgentKey, Record<Mode, Route>>;
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

/** A Mode-invariant agent routes identically under every Mode. */
function invariantRoute(route: Route): Record<Mode, Route> {
	return { low: { ...route }, medium: { ...route }, high: { ...route } };
}

export const BUILTIN_PROFILES: ResolvedProfiles = {
	modes: {
		low: { model: TERRA, reasoning: "low", posture: POSTURES.low },
		medium: { model: SOL, reasoning: "medium", posture: POSTURES.medium },
		high: { model: SOL, reasoning: "xhigh", posture: POSTURES.high },
	},
	agents: {
		finder: invariantRoute({ model: HAIKU, reasoning: "minimal" }),
		librarian: invariantRoute({ model: SOL, reasoning: "off" }),
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
	return profiles.agents[agent][mode];
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
 * Strictly parse a profiles.json document into a `ProfilesOverride` built
 * from the checked fields only — the raw shape never flows inward. Collects
 * every problem so one fix pass suffices; throws a single Error listing all
 * of them.
 */
export function validateProfilesOverride(raw: unknown): ProfilesOverride {
	const errors: string[] = [];
	const fail = (path: string, why: string) => errors.push(`${path}: ${why}`);

	const parseRouteFields = (
		path: string,
		value: unknown,
		allowed: readonly string[],
	): ModeOverride => {
		const out: ModeOverride = {};
		if (!isPlainObject(value)) {
			fail(path, "expected an object");
			return out;
		}
		for (const [field, fieldValue] of Object.entries(value)) {
			if (!allowed.includes(field)) {
				fail(path, `unknown field "${field}" (expected ${allowed.join(", ")})`);
			} else if (field === "model") {
				if (typeof fieldValue !== "string" || !MODEL_ID_RE.test(fieldValue)) {
					fail(`${path}.model`, `invalid model id ${JSON.stringify(fieldValue)} (expected "provider/model-id")`);
				} else {
					out.model = fieldValue;
				}
			} else if (field === "reasoning") {
				if (typeof fieldValue !== "string" || !REASONING_LEVELS.includes(fieldValue)) {
					fail(
						`${path}.reasoning`,
						`invalid reasoning level ${JSON.stringify(fieldValue)} (expected ${REASONING_LEVELS.join(", ")})`,
					);
				} else {
					out.reasoning = fieldValue as ReasoningLevel;
				}
			} else if (field === "posture") {
				if (typeof fieldValue !== "string") {
					fail(`${path}.posture`, "expected a string");
				} else {
					out.posture = fieldValue;
				}
			}
		}
		return out;
	};

	if (!isPlainObject(raw)) {
		throw new Error("Invalid profiles.json: expected an object at the top level");
	}

	const parsed: ProfilesOverride = {};

	for (const key of Object.keys(raw)) {
		if (key !== "modes" && key !== "agents") {
			fail("profiles.json", `unknown section "${key}" (expected "modes", "agents")`);
		}
	}

	if (raw.modes !== undefined) {
		if (!isPlainObject(raw.modes)) {
			fail("modes", "expected an object");
		} else {
			parsed.modes = {};
			for (const [mode, value] of Object.entries(raw.modes)) {
				if (!isMode(mode)) {
					fail("modes", `unknown Mode "${mode}" (expected ${MODES.join(", ")})`);
				} else {
					parsed.modes[mode] = parseRouteFields(`modes.${mode}`, value, ["model", "reasoning", "posture"]);
				}
			}
		}
	}

	if (raw.agents !== undefined) {
		if (!isPlainObject(raw.agents)) {
			fail("agents", "expected an object");
		} else {
			parsed.agents = {};
			for (const [agent, value] of Object.entries(raw.agents)) {
				if (!(AGENT_KEYS as readonly string[]).includes(agent)) {
					fail("agents", `unknown agent "${agent}" (expected ${AGENT_KEYS.join(", ")})`);
				} else if (PER_ROUTE_AGENTS.includes(agent as AgentKey)) {
					if (!isPlainObject(value)) {
						fail(`agents.${agent}`, "expected an object");
					} else {
						const routes: Partial<Record<Mode, RouteOverride>> = {};
						for (const [route, routeValue] of Object.entries(value)) {
							if (!isMode(route)) {
								fail(`agents.${agent}`, `unknown route "${route}" (expected ${MODES.join(", ")})`);
							} else {
								routes[route] = parseRouteFields(`agents.${agent}.${route}`, routeValue, ["model", "reasoning"]);
							}
						}
						parsed.agents[agent as "oracle" | "task"] = routes;
					}
				} else {
					parsed.agents[agent as "finder" | "librarian"] = parseRouteFields(
						`agents.${agent}`,
						value,
						["model", "reasoning"],
					);
				}
			}
		}
	}

	if (errors.length > 0) {
		throw new Error(`Invalid profiles.json:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
	}
	return parsed;
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

/** A flat (Mode-invariant) agent override applies under every Mode. */
function flatOverride(
	override: RouteOverride | undefined,
): Partial<Record<Mode, RouteOverride>> | undefined {
	return override ? { low: override, medium: override, high: override } : undefined;
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
			finder: mergePerRoute(base.agents.finder, flatOverride(override.agents?.finder)),
			librarian: mergePerRoute(base.agents.librarian, flatOverride(override.agents?.librarian)),
			oracle: mergePerRoute(base.agents.oracle, override.agents?.oracle),
			task: mergePerRoute(base.agents.task, override.agents?.task),
		},
	};
}

// ── Posture selection (§2.4) ──────────────────────────────────────

/** The posture block appended for a named Mode; custom (`null`) has none. */
export function selectPosture(profiles: ResolvedProfiles, mode: Mode | null): string | undefined {
	return mode === null ? undefined : profiles.modes[mode].posture;
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
