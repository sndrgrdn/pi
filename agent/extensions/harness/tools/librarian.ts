import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { buildEnvelope } from "../envelopes.ts";
import type { ResolvedProfiles } from "../profiles.ts";
import { resolveAgentRoute } from "../profiles.ts";
import { AGENT_TOOLBOX_MATRIX, resolveAgentDefinition } from "../registry.ts";
import { SubagentRunError, type SubagentRunner } from "../runner.ts";
import { createShellCancelTool } from "../shell/cancel.ts";
import { createShellCommandTool } from "../shell/command.ts";
import { createShellStatusTool } from "../shell/status.ts";
import { createSubagentRenderer } from "../ui/subagent.ts";
import { withTraceDetails } from "../ui/trace.ts";
import { createCheckoutTool } from "./checkout.ts";

const prompt = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), "..", "agents", "prompts", "librarian.md"),
	"utf8",
).trim();
const renderer = createSubagentRenderer<LibrarianInput>({
	action: "librarian",
	target: (args) => args.query,
});

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
	cancelledCalls = new Set<string>(),
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
		renderShell: "self",
		async execute(id, params: LibrarianInput, signal, onUpdate, ctx) {
			const actions = new Map<string, number>();
			const update = () =>
				onUpdate?.({
					content: [{ type: "text", text: `Librarian researching — ${params.query}` }],
					details: withTraceDetails({ actions: Object.fromEntries(actions) }, "running"),
				});
			update();
			try {
				const envelope = await runner.run({
					definition,
					cwd: ctx.cwd,
					input: params,
					signal,
					onAction: (name) => {
						actions.set(name, (actions.get(name) ?? 0) + 1);
						update();
					},
					toolbox: (processes) => [
						createCheckoutTool(),
						createShellCommandTool(processes),
						createShellStatusTool(processes),
						createShellCancelTool(processes),
					],
					mapInput: librarianMessage,
					wrapResult: (sessionID, content) => buildEnvelope({ kind: "librarian", sessionID, content }),
				});
				return { content: [{ type: "text", text: envelope }], details: withTraceDetails(undefined, "success") };
			} catch (error) {
				if (signal?.aborted || (error instanceof SubagentRunError && error.name === "AbortError"))
					cancelledCalls.add(id);
				throw mapLibrarianError(error);
			}
		},
		renderCall: renderer.renderCall,
		renderResult: renderer.renderResult,
	} as ToolDefinition<any, any, any>;
}
