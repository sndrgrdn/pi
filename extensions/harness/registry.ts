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

export class AgentRegistry {
	private readonly entries: Map<AgentKey, AgentDefinition>;

	constructor(entries: readonly AgentDefinition[]) {
		this.entries = new Map(entries.map((entry) => [entry.key, entry]));
		if (this.entries.size !== entries.length) throw new Error("duplicate agent key");
	}

	get(key: AgentKey): AgentDefinition {
		const entry = this.entries.get(key);
		if (!entry) throw new Error(`unknown agent "${key}"`);
		return entry;
	}
}
