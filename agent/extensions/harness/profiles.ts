/**
 * Profiles — built-in resolved bundles + profiles.json load/validate/merge.
 *
 * A Profile is an internal resolved bundle: model and reasoning per Mode for
 * Main, plus per-agent routes. Route tables for Mode-dependent
 * agents (Oracle, Task) live here, not in the agent registry. The optional
 * global `~/.pi/agent/profiles.json` is a strict two-section partial
 * override; validation failures are loud and precise, with no fallback.
 */
import { existsSync, readFileSync } from "node:fs";

export type ProfileMode = "low" | "medium" | "high" | "ultra";
export type Mode = ProfileMode | "custom";
export const MODES = ["low", "medium", "high", "ultra"] as const satisfies readonly ProfileMode[];
export const DEFAULT_MODE: ProfileMode = "medium";

export type ReasoningLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
const REASONING_LEVELS: readonly string[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

/** A resolved `{model, reasoning}` pair handed to pi / the subagent runner. */
export interface Route {
	/** `provider/model-id`, e.g. `openai-codex/gpt-5.6-sol`. */
	model: string;
	reasoning: ReasoningLevel;
}

export type AgentKey = "finder" | "librarian" | "oracle" | "task";

/**
 * Resolved bundles. Agents are uniformly `Record<ProfileMode, Route>`: Mode-invariant
 * agents (Finder, Librarian) simply carry the same route under every Mode —
 * the flat-vs-per-route distinction is a profiles.json schema fact,
 * not a resolved-bundle fact.
 */
export interface ResolvedProfiles {
	modes: Record<ProfileMode, Route>;
	agents: Record<AgentKey, Record<ProfileMode, Route>>;
}

// ── Built-in defaults ─────────────────────────────────────────────

const TERRA = "openai-codex/gpt-5.6-terra";
const SOL = "openai-codex/gpt-5.6-sol";
const FABLE = "anthropic/claude-fable-5";
const HAIKU = "anthropic/claude-haiku-4-5";

/** A Mode-invariant agent routes identically under every Mode. */
function invariantRoute(route: Route): Record<ProfileMode, Route> {
	return { low: { ...route }, medium: { ...route }, high: { ...route }, ultra: { ...route } };
}

export const BUILTIN_PROFILES: ResolvedProfiles = {
	modes: {
		low: { model: TERRA, reasoning: "low" },
		medium: { model: SOL, reasoning: "medium" },
		high: { model: SOL, reasoning: "xhigh" },
		ultra: { model: FABLE, reasoning: "high" },
	},
	agents: {
		finder: invariantRoute({ model: HAIKU, reasoning: "minimal" }),
		librarian: invariantRoute({ model: SOL, reasoning: "off" }),
		oracle: {
			low: { model: SOL, reasoning: "high" },
			medium: { model: SOL, reasoning: "high" },
			high: { model: FABLE, reasoning: "high" },
			ultra: { model: SOL, reasoning: "high" },
		},
		task: {
			low: { model: SOL, reasoning: "low" },
			medium: { model: SOL, reasoning: "high" },
			high: { model: SOL, reasoning: "high" },
			ultra: { model: FABLE, reasoning: "high" },
		},
	},
};

// ── Route resolution ──────────────────────────────────────────────

/** Main's route for a Mode. */
export function resolveMainRoute(profiles: ResolvedProfiles, mode: ProfileMode): Route {
	const { model, reasoning } = profiles.modes[mode];
	return { model, reasoning };
}

/**
 * An agent's route. Finder/Librarian are Mode-invariant; Oracle routes from
 * the parent's Mode, Task from its per-call `mode` param.
 */
export function resolveAgentRoute(profiles: ResolvedProfiles, agent: AgentKey, mode: ProfileMode): Route {
	return profiles.agents[agent][mode];
}

// ── profiles.json validation ──────────────────────────────────────

/** Partial override shape accepted from profiles.json. */
export interface RouteOverride {
	model?: string;
	reasoning?: ReasoningLevel;
}

export interface ProfilesOverride {
	modes?: Partial<Record<ProfileMode, RouteOverride>>;
	agents?: {
		finder?: RouteOverride;
		librarian?: RouteOverride;
		oracle?: Partial<Record<ProfileMode, RouteOverride>>;
		task?: Partial<Record<ProfileMode, RouteOverride>>;
	};
}

export const AGENT_KEYS: readonly AgentKey[] = ["finder", "librarian", "oracle", "task"];
const PER_ROUTE_AGENTS: readonly AgentKey[] = ["oracle", "task"];

// Shape-level model id check: `provider/model-id`. Whether the model actually
// exists/authenticates is resolved live via pi's registry and setModel. There
// is no fallback machinery; pi natively owns provider failures.
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

	const parseRouteFields = (path: string, value: unknown, allowed: readonly string[]): RouteOverride => {
		const out: RouteOverride = {};
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
				if (!(MODES as readonly string[]).includes(mode)) {
					fail("modes", `unknown Mode "${mode}" (expected ${MODES.join(", ")})`);
				} else {
					parsed.modes[mode as ProfileMode] = parseRouteFields(`modes.${mode}`, value, ["model", "reasoning"]);
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
						const routes: Partial<Record<ProfileMode, RouteOverride>> = {};
						for (const [route, routeValue] of Object.entries(value)) {
							if (!(MODES as readonly string[]).includes(route)) {
								fail(`agents.${agent}`, `unknown route "${route}" (expected ${MODES.join(", ")})`);
							} else {
								routes[route as ProfileMode] = parseRouteFields(`agents.${agent}.${route}`, routeValue, [
									"model",
									"reasoning",
								]);
							}
						}
						parsed.agents[agent as "oracle" | "task"] = routes;
					}
				} else {
					parsed.agents[agent as "finder" | "librarian"] = parseRouteFields(`agents.${agent}`, value, [
						"model",
						"reasoning",
					]);
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

function mergeRoute<T extends Route>(base: T, override: RouteOverride | undefined): T {
	return override ? { ...base, ...override } : { ...base };
}

function mergePerRoute(
	base: Record<ProfileMode, Route>,
	override: Partial<Record<ProfileMode, RouteOverride>> | undefined,
): Record<ProfileMode, Route> {
	return {
		low: mergeRoute(base.low, override?.low),
		medium: mergeRoute(base.medium, override?.medium),
		high: mergeRoute(base.high, override?.high),
		ultra: mergeRoute(base.ultra, override?.ultra),
	};
}

/** A flat (Mode-invariant) agent override applies under every Mode. */
function flatOverride(override: RouteOverride | undefined): Partial<Record<ProfileMode, RouteOverride>> | undefined {
	return override ? { low: override, medium: override, high: override, ultra: override } : undefined;
}

/** Field-level merge of a validated override over the built-in defaults. */
export function mergeProfiles(base: ResolvedProfiles, override: ProfilesOverride): ResolvedProfiles {
	return {
		modes: {
			low: mergeRoute(base.modes.low, override.modes?.low),
			medium: mergeRoute(base.modes.medium, override.modes?.medium),
			high: mergeRoute(base.modes.high, override.modes?.high),
			ultra: mergeRoute(base.modes.ultra, override.modes?.ultra),
		},
		agents: {
			finder: mergePerRoute(base.agents.finder, flatOverride(override.agents?.finder)),
			librarian: mergePerRoute(base.agents.librarian, flatOverride(override.agents?.librarian)),
			oracle: mergePerRoute(base.agents.oracle, override.agents?.oracle),
			task: mergePerRoute(base.agents.task, override.agents?.task),
		},
	};
}

// ── Load (startup seam) ───────────────────────────────────────────

/**
 * Load resolved Profiles: built-in defaults, optionally overridden by a
 * global profiles.json. Missing file → defaults. Malformed or invalid file →
 * loud Error naming the file; no fallback.
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
