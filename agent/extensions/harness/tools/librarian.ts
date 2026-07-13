import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { buildEnvelope } from "../envelopes.ts";
import type { ResolvedProfiles } from "../profiles.ts";
import { resolveAgentRoute } from "../profiles.ts";
import { AGENT_TOOLBOX_MATRIX, resolveAgentDefinition } from "../registry.ts";
import type { SubagentRunner } from "../runner.ts";
import { createShellCancelTool } from "../shell/cancel.ts";
import { createShellCommandTool } from "../shell/command.ts";
import { createShellStatusTool } from "../shell/status.ts";
import { createSubagentRenderer } from "../ui/subagent.ts";
import { createCheckoutTool } from "./checkout.ts";

const prompt = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), "..", "agents", "prompts", "librarian.md"),
	"utf8",
).trim();
const renderer = createSubagentRenderer({ running: "Librarian researching", complete: "Librarian researched" });

export interface LibrarianInput {
	query: string;
	context?: string;
}

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

export function createLibrarianTool(
	runner: Pick<SubagentRunner, "run">,
	profiles: ResolvedProfiles,
): ToolDefinition<any, any, any> {
	const toolbox = AGENT_TOOLBOX_MATRIX.librarian;
	const definition = resolveAgentDefinition(
		{
			key: "librarian",
			systemPrompt: prompt,
			...toolbox,
		},
		resolveAgentRoute(profiles, "librarian", "medium"),
	);
	return {
		name: "librarian",
		label: "librarian",
		description: "Delegate remote repository and web research. Returns source-linked findings.",
		parameters: Type.Object({
			query: Type.String({ description: "The external research question." }),
			context: Type.Optional(Type.String({ description: "Relevant context prepended to the research query." })),
		}),
		async execute(_id, params: LibrarianInput, signal, onUpdate, ctx) {
			onUpdate?.({
				content: [{ type: "text", text: `Librarian researching — ${params.query}` }],
				details: { state: "running", query: params.query },
			});
			try {
				const envelope = await runner.run({
					definition,
					cwd: ctx.cwd,
					input: params,
					signal,
					toolbox: (processes) => [
						createCheckoutTool(),
						createShellCommandTool(processes),
						createShellStatusTool(processes),
						createShellCancelTool(processes),
					],
					mapInput: librarianMessage,
					wrapResult: (sessionID, content) => buildEnvelope({ kind: "librarian", sessionID, content }),
				});
				return { content: [{ type: "text", text: envelope }], details: { state: "complete" } };
			} catch (error) {
				throw mapLibrarianError(error);
			}
		},
		renderCall(args: LibrarianInput | undefined, theme, context) {
			return renderer.renderCall({ detail: args?.query }, theme, context);
		},
		renderResult(result, options, theme, context) {
			return renderer.renderResult(result, options, theme, context);
		},
	} as ToolDefinition<any, any, any>;
}
