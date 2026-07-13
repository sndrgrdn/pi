import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type AgentToolSpec, createAgentTool } from "../agent-tool.ts";
import type { ResolvedProfiles } from "../profiles.ts";
import type { SubagentRunner } from "../runner.ts";
import { createShellCancelTool } from "../shell/cancel.ts";
import { createShellCommandTool } from "../shell/command.ts";
import { createShellStatusTool } from "../shell/status.ts";
import { createCheckoutTool } from "./checkout.ts";

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

const spec: AgentToolSpec<LibrarianParams> = {
	key: "librarian",
	name: "librarian",
	description: "Delegate remote repository and web research. Returns source-linked findings.",
	parameters: Type.Object({
		query: Type.String({ description: "The external research question." }),
		context: Type.Optional(Type.String({ description: "Relevant context prepended to the research query." })),
	}),
	mode: () => "medium",
	plan: (params) => ({
		systemPrompt: prompt,
		message: librarianMessage(params),
		toolbox: (processes) => [
			createCheckoutTool(),
			createShellCommandTool(processes),
			createShellStatusTool(processes),
			createShellCancelTool(processes),
		],
	}),
	finalize: (answer) => ({ content: answer }),
	recover: (error) => {
		throw mapLibrarianError(error); // always rethrows — friendlier message for context exhaustion
	},
	presentation: { action: "librarian", target: (params) => params.query },
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
};

export function createLibrarianTool(
	runner: Pick<SubagentRunner, "run">,
	profiles: ResolvedProfiles,
): ToolDefinition<any, any, any> {
	return createAgentTool(spec, runner, profiles);
}
