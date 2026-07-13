import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type AgentToolSpec, createAgentTool } from "../agent-tool.ts";
import type { ResolvedProfiles } from "../profiles.ts";
import type { SubagentRunner } from "../runner.ts";

const prompt = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), "..", "agents", "prompts", "finder.md"),
	"utf8",
).trim();

interface FinderParams {
	query: string;
}

function extractFinderAnswer(answer: string): { title: string; content: string } {
	const lines = answer.trim().split(/\r?\n/);
	if (!lines[0]) return { title: "Nothing matched", content: "Nothing matched." };
	const title = lines.shift()?.trim() || "Finder result";
	const content =
		lines.join("\n").trim() || (title.toLowerCase().includes("nothing matched") ? "Nothing matched." : title);
	return { title, content };
}

const spec: AgentToolSpec<FinderParams, "finder"> = {
	key: "finder",
	name: "finder",
	description:
		"Delegate local codebase search to a read-only scout. Needle queries (known symbol, exact string, path) — grep yourself; use finder for broader discovery: behavior, flows, correlated patterns. Use parallel finder calls for independent queries.",
	parameters: Type.Object({ query: Type.String({ description: "What to locate and the desired thoroughness." }) }),
	mode: () => "medium",
	plan: (params) => ({ systemPrompt: prompt, message: params.query }),
	finalize: extractFinderAnswer,
	presentation: { action: "finder", target: (params) => params.query },
	tools: ["read", "grep", "find", "ls"],
	allowMcp: false,
};

export function createFinderTool(
	runner: Pick<SubagentRunner, "run">,
	profiles: ResolvedProfiles,
): ToolDefinition<any, any, any> {
	return createAgentTool(spec, runner, profiles);
}
