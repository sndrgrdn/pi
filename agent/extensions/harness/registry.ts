import type { ReasoningLevel, Route } from "./profiles.ts";

export type AgentKey = "finder" | "librarian" | "oracle" | "task";

export interface AgentToolboxDefinition {
	tools: readonly string[];
	allowMcp: boolean;
}

/**
 * Spec §6 toolbox matrix for the agents not yet migrated to the Agent Tool
 * factory (#9 expand phase). Migrated agents declare `tools`/`allowMcp` in
 * their own spec; their entries leave this record with the migration.
 */
export const AGENT_TOOLBOX_MATRIX = {
	librarian: {
		tools: [
			"checkout",
			"grep",
			"find",
			"read",
			"shell_command",
			"shell_command_status",
			"shell_command_cancel",
			"web_search_exa",
			"web_fetch_exa",
		],
		allowMcp: false,
	},
	oracle: {
		tools: ["shell_command", "shell_command_status", "shell_command_cancel", "finder", "librarian"],
		allowMcp: false,
	},
	task: {
		tools: [
			"shell_command",
			"shell_command_status",
			"shell_command_cancel",
			"read",
			"apply_patch",
			"skill",
			"finder",
			"librarian",
		],
		allowMcp: true,
	},
} as const satisfies Record<Exclude<AgentKey, "finder">, AgentToolboxDefinition>;

export interface AgentBaseDefinition {
	key: AgentKey;
	systemPrompt: string;
	tools: readonly string[];
	allowMcp: boolean;
}

/** A route-resolved, invocation-ready registry entry (spec §3.1). */
export interface AgentDefinition extends AgentBaseDefinition {
	model: string;
	reasoningEffort: ReasoningLevel;
}

export function resolveAgentDefinition(base: AgentBaseDefinition, route: Route): AgentDefinition {
	return {
		...base,
		model: route.model,
		reasoningEffort: route.reasoning,
		tools: [...base.tools],
	};
}
