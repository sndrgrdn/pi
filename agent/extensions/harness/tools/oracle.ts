import { readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { buildEnvelope } from "../envelopes.ts";
import { DEFAULT_MODE, type Mode, type ResolvedProfiles, resolveAgentRoute } from "../profiles.ts";
import { AGENT_TOOLBOX_MATRIX, resolveAgentDefinition } from "../registry.ts";
import { SubagentRunError, type SubagentRunner } from "../runner.ts";
import { createShellCancelTool } from "../shell/cancel.ts";
import { createShellCommandTool } from "../shell/command.ts";
import { createShellStatusTool } from "../shell/status.ts";
import { createSubagentRenderer } from "../ui/subagent.ts";
import { withTraceDetails } from "../ui/trace.ts";
import { createFinderTool } from "./finder.ts";
import { createLibrarianTool } from "./librarian.ts";

const prompt = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), "..", "agents", "prompts", "oracle.md"),
	"utf8",
).trim();
const renderer = createSubagentRenderer<OracleInput>({
	action: "oracle",
	target: (args) => args.task,
});

export interface OracleInput {
	task: string;
	context?: string;
	files?: string[];
}

export function oracleMessage(input: OracleInput, cwd: string): string {
	const sections = [`Task: ${input.task}`];
	if (input.context) sections.push(`Context: ${input.context}`);
	for (const path of input.files ?? []) {
		try {
			const content = readFileSync(resolve(cwd, path), "utf8").replace(/\n$/, "");
			let longestRun = 0;
			for (const match of content.matchAll(/`+/g)) longestRun = Math.max(longestRun, match[0].length);
			const fence = "`".repeat(Math.max(3, longestRun + 1));
			sections.push(`File: ${path}\n${fence}${extname(path).slice(1)}\n${content}\n${fence}`);
		} catch {
			// Oracle can recover unreadable paths through its inspection tools.
		}
	}
	return sections.join("\n\n");
}

type ActiveMode = () => Mode | null;

export function createOracleTool(
	runner: Pick<SubagentRunner, "run">,
	profiles: ResolvedProfiles,
	activeMode: ActiveMode,
	cancelledCalls = new Set<string>(),
): ToolDefinition<any, any, any> {
	return {
		name: "oracle",
		label: "oracle",
		description: "Get a read-only senior advisor's second opinion on a bounded technical question.",
		parameters: Type.Object({
			task: Type.String({ description: "The review, debugging, architecture, or design question." }),
			context: Type.Optional(Type.String({ description: "Relevant constraints or background." })),
			files: Type.Optional(
				Type.Array(Type.String(), { description: "Files whose readable contents should be supplied." }),
			),
		}),
		async execute(id, params: OracleInput, signal, onUpdate, ctx) {
			const actions = new Map<string, number>();
			const update = () =>
				onUpdate?.({
					content: [{ type: "text", text: `Oracle exploring — ${params.task}` }],
					details: withTraceDetails({ actions: Object.fromEntries(actions) }, "running"),
				});
			update();
			const definition = resolveAgentDefinition(
				{
					key: "oracle",
					systemPrompt: `${prompt}\n\nWorking directory: ${ctx.cwd}\nCurrent date: ${new Date().toISOString().slice(0, 10)}`,
					...AGENT_TOOLBOX_MATRIX.oracle,
				},
				resolveAgentRoute(profiles, "oracle", activeMode() ?? DEFAULT_MODE),
			);
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
						createShellCommandTool(processes),
						createShellStatusTool(processes),
						createShellCancelTool(processes),
						createFinderTool(runner, profiles),
						createLibrarianTool(runner, profiles),
					],
					mapInput: (input) => oracleMessage(input, ctx.cwd),
					wrapResult: (sessionID, content) => {
						if (!content.trim()) throw new Error("Oracle child returned an empty final message");
						return buildEnvelope({ kind: "oracle", sessionID, content });
					},
				});
				return { content: [{ type: "text", text: envelope }], details: withTraceDetails(undefined, "success") };
			} catch (error) {
				if (signal?.aborted || (error instanceof SubagentRunError && error.name === "AbortError"))
					cancelledCalls.add(id);
				throw error;
			}
		},
		renderCall: renderer.renderCall,
		renderResult: renderer.renderResult,
	} as ToolDefinition<any, any, any>;
}
