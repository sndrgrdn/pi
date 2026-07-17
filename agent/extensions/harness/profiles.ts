/** Agent profiles — built-in routes plus profiles.json load, validation, and merge. */
import { existsSync, readFileSync } from "node:fs";

export type ReasoningLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
const REASONING_LEVELS: readonly string[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

export interface Route {
	/** `provider/model-id`, e.g. `openai-codex/gpt-5.6-sol`. */
	model: string;
	reasoning: ReasoningLevel;
}

export type AgentKey = "finder" | "librarian" | "oracle" | "task";
export type FixedAgentKey = Exclude<AgentKey, "task">;
export type TaskEffort = "standard" | "high";
export const TASK_EFFORTS = ["standard", "high"] as const satisfies readonly TaskEffort[];

export interface ResolvedProfiles {
	agents: Record<FixedAgentKey, Route> & { task: Record<TaskEffort, Route> };
}

const SOL = "openai-codex/gpt-5.6-sol";
const HAIKU = "anthropic/claude-haiku-4-5";

export const BUILTIN_PROFILES: ResolvedProfiles = {
	agents: {
		finder: { model: HAIKU, reasoning: "minimal" },
		librarian: { model: SOL, reasoning: "off" },
		oracle: { model: SOL, reasoning: "high" },
		task: {
			standard: { model: SOL, reasoning: "low" },
			high: { model: SOL, reasoning: "high" },
		},
	},
};

export interface RouteOverride {
	model?: string;
	reasoning?: ReasoningLevel;
}

export interface ProfilesOverride {
	agents?: Partial<Record<FixedAgentKey, RouteOverride>> & {
		task?: Partial<Record<TaskEffort, RouteOverride>>;
	};
}

export const AGENT_KEYS: readonly AgentKey[] = ["finder", "librarian", "oracle", "task"];
const MODEL_ID_RE = /^[^\s/]+\/[^\s/][^\s]*$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRoute(path: string, value: unknown): RouteOverride {
	if (!isPlainObject(value)) throw new Error(`${path}: expected an object`);
	const route: RouteOverride = {};
	for (const [field, fieldValue] of Object.entries(value)) {
		if (field === "model") {
			if (typeof fieldValue !== "string" || !MODEL_ID_RE.test(fieldValue)) {
				throw new Error(`${path}.model: invalid model id ${JSON.stringify(fieldValue)}`);
			}
			route.model = fieldValue;
		} else if (field === "reasoning") {
			if (typeof fieldValue !== "string" || !REASONING_LEVELS.includes(fieldValue)) {
				throw new Error(`${path}.reasoning: invalid reasoning level ${JSON.stringify(fieldValue)}`);
			}
			route.reasoning = fieldValue as ReasoningLevel;
		} else {
			throw new Error(`${path}: unknown field "${field}"`);
		}
	}
	return route;
}

/** Validate untyped profiles.json input and return only checked fields. */
export function validateProfilesOverride(raw: unknown): ProfilesOverride {
	if (!isPlainObject(raw)) throw new Error("Invalid profiles.json: expected an object at the top level");
	for (const section of Object.keys(raw)) {
		if (section !== "agents") throw new Error(`Invalid profiles.json: unknown section "${section}"`);
	}
	if (raw.agents === undefined) return {};
	if (!isPlainObject(raw.agents)) throw new Error("Invalid profiles.json: agents: expected an object");

	const agents: NonNullable<ProfilesOverride["agents"]> = {};
	for (const [agent, value] of Object.entries(raw.agents)) {
		if (!(AGENT_KEYS as readonly string[]).includes(agent)) {
			throw new Error(`Invalid profiles.json: unknown agent "${agent}"`);
		}
		if (agent === "task") {
			if (!isPlainObject(value)) throw new Error("Invalid profiles.json: agents.task: expected an object");
			const routes: Partial<Record<TaskEffort, RouteOverride>> = {};
			for (const [effort, route] of Object.entries(value)) {
				if (!(TASK_EFFORTS as readonly string[]).includes(effort)) {
					throw new Error(`Invalid profiles.json: agents.task: unknown effort "${effort}"`);
				}
				routes[effort as TaskEffort] = parseRoute(`agents.task.${effort}`, route);
			}
			agents.task = routes;
		} else {
			agents[agent as FixedAgentKey] = parseRoute(`agents.${agent}`, value);
		}
	}
	return { agents };
}

function mergeRoute(base: Route, override: RouteOverride | undefined): Route {
	return override ? { ...base, ...override } : { ...base };
}

export function mergeProfiles(base: ResolvedProfiles, override: ProfilesOverride): ResolvedProfiles {
	return {
		agents: {
			finder: mergeRoute(base.agents.finder, override.agents?.finder),
			librarian: mergeRoute(base.agents.librarian, override.agents?.librarian),
			oracle: mergeRoute(base.agents.oracle, override.agents?.oracle),
			task: {
				standard: mergeRoute(base.agents.task.standard, override.agents?.task?.standard),
				high: mergeRoute(base.agents.task.high, override.agents?.task?.high),
			},
		},
	};
}

/** Load profiles once at startup. Missing files use defaults; invalid files fail loudly. */
export function loadProfiles(filePath: string): ResolvedProfiles {
	if (!existsSync(filePath)) return structuredClone(BUILTIN_PROFILES);
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(filePath, "utf8"));
	} catch (error) {
		throw new Error(`Invalid profiles.json (${filePath}): ${error instanceof Error ? error.message : String(error)}`);
	}
	return mergeProfiles(BUILTIN_PROFILES, validateProfilesOverride(parsed));
}
