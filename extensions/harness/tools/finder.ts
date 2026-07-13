import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { buildEnvelope, parseEnvelope } from "../envelopes.ts";
import type { ResolvedProfiles } from "../profiles.ts";
import { resolveAgentRoute } from "../profiles.ts";
import { resolveAgentDefinition } from "../registry.ts";
import type { SubagentRunner } from "../runner.ts";
import { createSubagentRenderer } from "../ui/subagent.ts";

const prompt = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "agents", "prompts", "finder.md"), "utf8").trim();
const renderer = createSubagentRenderer({ running: "Finder searching", complete: "Finder finished" });

export interface FinderAnswer { title: string; content: string }

export function extractFinderAnswer(answer: string): FinderAnswer {
	const lines = answer.trim().split(/\r?\n/);
	if (!lines[0]) return { title: "Nothing matched", content: "Nothing matched." };
	const title = lines.shift()?.trim() || "Finder result";
	const content = lines.join("\n").trim() || (title.toLowerCase().includes("nothing matched") ? "Nothing matched." : title);
	return { title, content };
}

export function finderEnvelopeTitle(envelope: string): string | undefined {
	const parsed = parseEnvelope(envelope);
	return parsed?.tag === "finder_result" ? parsed.title : undefined;
}

export function createFinderTool(runner: Pick<SubagentRunner, "run">, profiles: ResolvedProfiles): ToolDefinition<any, any, any> {
	const definition = resolveAgentDefinition({
		key: "finder", systemPrompt: prompt, tools: ["read", "grep", "find", "ls"], allowMcp: false,
	}, resolveAgentRoute(profiles, "finder", "medium"));
	return {
		name: "finder",
		label: "finder",
		description: "Delegate local codebase search to a read-only scout. Use parallel finder calls for independent queries.",
		parameters: Type.Object({ query: Type.String({ description: "What to locate and the desired thoroughness." }) }),
		async execute(_id, params: { query: string }, signal, onUpdate, ctx) {
			const actions = new Map<string, number>();
			const update = () => {
				const tally = [...actions].map(([name, count]) => `${name} ×${count}`).join(", ");
				onUpdate?.({ content: [{ type: "text", text: `Finder searching — ${params.query}${tally ? ` — ${tally}` : ""}` }], details: { state: "running", query: params.query, actions: Object.fromEntries(actions) } });
			};
			update();
			const envelope = await runner.run({
				definition, cwd: ctx.cwd, input: params, signal,
				onAction: (name) => { actions.set(name, (actions.get(name) ?? 0) + 1); update(); },
				mapInput: (input) => input.query,
				wrapResult: (sessionID, answer) => {
					const result = extractFinderAnswer(answer);
					return buildEnvelope({ kind: "finder", sessionID, title: result.title, content: result.content });
				},
			});
			return { content: [{ type: "text", text: envelope }], details: { title: finderEnvelopeTitle(envelope) } };
		},
		renderCall(args: { query?: string } | undefined, theme, context) {
			return renderer.renderCall({ detail: args?.query }, theme, context);
		},
		renderResult(result, options, theme, context) {
			return renderer.renderResult(result, options, theme, context);
		},
	} as ToolDefinition<any, any, any>;
}
