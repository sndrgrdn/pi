import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type AgentToolSpec, createAgentTool } from "../agent-tool.ts";
import type { ResolvedProfiles } from "../profiles.ts";
import type { SubagentRunner } from "../runner.ts";
import { createShellToolbox, SHELL_TOOLBOX_NAMES } from "../shell/toolbox.ts";
import { createCheckoutTool } from "./checkout.ts";
import { createWebFetchTool } from "./web-fetch.ts";
import { createWebSearchTool } from "./web-search.ts";

const prompt = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), "..", "agents", "prompts", "librarian.md"),
	"utf8",
).trim();

interface LibrarianParams {
	query: string;
	context?: string;
}

function librarianMessage(params: LibrarianParams): string {
	return params.context ? `Context: ${params.context}\n\nQuery: ${params.query}` : `Query: ${params.query}`;
}

function mapLibrarianError(error: unknown): Error {
	const resolved = error instanceof Error ? error : new Error(String(error));
	if (/context (?:length|window)|maximum context|too many tokens/i.test(resolved.message)) {
		return new Error("Librarian exhausted its context window; try a more specific query.");
	}
	return resolved;
}

export function createLibrarianTool(
	runner: Pick<SubagentRunner, "run">,
	profiles: ResolvedProfiles,
): ToolDefinition<any, any, any> {
	const spec: AgentToolSpec<LibrarianParams, "librarian"> = {
		key: "librarian",
		name: "librarian",
		description:
			"Research external repositories and the web with a read-only scout. Use Finder for the local workspace. Returns source-linked findings.",
		parameters: Type.Object({
			query: Type.String({ description: "Question to research externally." }),
			context: Type.Optional(Type.String({ description: "Constraints or background for the research." })),
		}),
		route: () => profiles.agents.librarian,
		plan: (params) => ({
			systemPrompt: prompt,
			message: librarianMessage(params),
			toolbox: (processes) => [
				createCheckoutTool(),
				...createShellToolbox(processes),
				createWebSearchTool(),
				createWebFetchTool(),
			],
		}),
		finalize: (answer) => ({ content: answer }),
		recover: (error) => {
			throw mapLibrarianError(error);
		},
		presentation: { action: "librarian", target: (params) => params.query },
		tools: ["checkout", "grep", "find", "read", ...SHELL_TOOLBOX_NAMES, "web_search", "web_fetch"],
		allowMcp: false,
	};
	return createAgentTool(spec, runner);
}
