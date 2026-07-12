import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { buildEnvelope } from "../envelopes.ts";
import type { ResolvedProfiles } from "../profiles.ts";
import { resolveAgentRoute } from "../profiles.ts";
import { resolveAgentDefinition } from "../registry.ts";
import { SubagentRunner } from "../runner.ts";
import { renderToolTitle } from "../shell/output.ts";

const prompt = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "agents", "prompts", "librarian.md"), "utf8").trim();

export interface LibrarianInput { query: string; context?: string }

export function librarianMessage(input: LibrarianInput): string {
	return input.context ? `Context: ${input.context}\n\nQuery: ${input.query}` : `Query: ${input.query}`;
}

export function mapLibrarianError(error: unknown): Error {
	const resolved = error instanceof Error ? error : new Error(String(error));
	if (/context (?:length|window)|maximum context|too many tokens/i.test(resolved.message)) {
		return new Error("Librarian exhausted its context window; try a more specific query.");
	}
	return resolved;
}

export function createLibrarianTool(runner: Pick<SubagentRunner, "run">, profiles: ResolvedProfiles): ToolDefinition<any, any, any> {
	const definition = resolveAgentDefinition({
		key: "librarian",
		systemPrompt: prompt,
		tools: ["checkout", "grep", "find", "read", "shell_command", "shell_command_status", "shell_command_cancel", "web_search_exa", "web_fetch_exa"],
		allowMcp: false,
	}, resolveAgentRoute(profiles, "librarian", "medium"));
	return {
		name: "librarian",
		label: "librarian",
		description: "Delegate remote repository and web research. Returns source-linked findings.",
		parameters: Type.Object({
			query: Type.String({ description: "The external research question." }),
			context: Type.Optional(Type.String({ description: "Relevant context prepended to the research query." })),
		}),
		async execute(_id, params: LibrarianInput, signal, onUpdate, ctx) {
			onUpdate?.({ content: [{ type: "text", text: `Librarian researching — ${params.query}` }], details: { state: "running", query: params.query } });
			try {
				const envelope = await runner.run({
					definition, cwd: ctx.cwd, input: params, signal,
					mapInput: librarianMessage,
					wrapResult: (sessionID, content) => buildEnvelope({ kind: "librarian", sessionID, content }),
				});
				return { content: [{ type: "text", text: envelope }], details: { state: "complete" } };
			} catch (error) { throw mapLibrarianError(error); }
		},
		renderCall(args: LibrarianInput | undefined, theme, context) {
			return renderToolTitle(`Librarian researching${args?.query ? ` — ${args.query}` : ""}`, theme, context);
		},
		renderResult(result, options, theme) {
			const item = result?.content?.find((entry: { type: string }) => entry.type === "text");
			const text = item?.type === "text" ? item.text : "";
			if (!options.expanded) return new Text(theme.fg("success", "✓ Librarian researched"), 0, 0);
			return new Text(`${theme.fg("success", "✓ Librarian researched")}\n${theme.fg("muted", text)}`, 0, 0);
		},
	} as ToolDefinition<any, any, any>;
}

export function registerLibrarian(pi: ExtensionAPI, profiles: ResolvedProfiles): void {
	pi.registerTool(createLibrarianTool(new SubagentRunner(), profiles));
}
