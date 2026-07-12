import type { ReasoningLevel, Route } from "./profiles.ts";

export type AgentKey = "finder" | "librarian" | "oracle" | "task";

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

export function defineAgent(base: AgentBaseDefinition, route: Route): AgentDefinition {
	return {
		...base,
		model: route.model,
		reasoningEffort: route.reasoning,
		tools: [...base.tools],
	};
}
