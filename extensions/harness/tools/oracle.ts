import { readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { buildEnvelope } from "../envelopes.ts";
import { DEFAULT_MODE, type Mode, type ResolvedProfiles, resolveAgentRoute } from "../profiles.ts";
import { resolveAgentDefinition } from "../registry.ts";
import { SubagentRunner } from "../runner.ts";
import { createSubagentRenderer } from "../ui/subagent.ts";

const prompt = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "agents", "prompts", "oracle.md"), "utf8").trim();
const renderer = createSubagentRenderer({ running: "Oracle exploring", complete: "Oracle has spoken" });

export interface OracleInput {
	task: string;
	context?: string;
	files?: string[];
}

function languageFor(path: string): string {
	return extname(path).slice(1);
}

export function oracleMessage(input: OracleInput, cwd: string): string {
	const sections = [`Task: ${input.task}`];
	if (input.context) sections.push(`Context: ${input.context}`);
	for (const path of input.files ?? []) {
		try {
			const content = readFileSync(resolve(cwd, path), "utf8").replace(/\n$/, "");
			sections.push(`File: ${path}\n\`\`\`${languageFor(path)}\n${content}\n\`\`\``);
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
): ToolDefinition<any, any, any> {
	return {
		name: "oracle",
		label: "oracle",
		description: "Get a read-only senior advisor's second opinion on a bounded technical question.",
		parameters: Type.Object({
			task: Type.String({ description: "The review, debugging, architecture, or design question." }),
			context: Type.Optional(Type.String({ description: "Relevant constraints or background." })),
			files: Type.Optional(Type.Array(Type.String(), { description: "Files whose readable contents should be supplied." })),
		}),
		async execute(_id, params: OracleInput, signal, onUpdate, ctx) {
			onUpdate?.({ content: [{ type: "text", text: `Oracle exploring — ${params.task}` }], details: { state: "running", query: params.task } });
			const definition = resolveAgentDefinition({
				key: "oracle",
				systemPrompt: `${prompt}\n\nWorking directory: ${ctx.cwd}\nCurrent date: ${new Date().toISOString().slice(0, 10)}`,
				tools: ["shell_command", "shell_command_status", "shell_command_cancel", "finder", "librarian"],
				allowMcp: false,
			}, resolveAgentRoute(profiles, "oracle", activeMode() ?? DEFAULT_MODE));
			const envelope = await runner.run({
				definition, cwd: ctx.cwd, input: params, signal,
				mapInput: (input) => oracleMessage(input, ctx.cwd),
				wrapResult: (sessionID, content) => {
					if (!content.trim()) throw new Error("Oracle child returned an empty final message");
					return buildEnvelope({ kind: "oracle", sessionID, content });
				},
			});
			return { content: [{ type: "text", text: envelope }], details: { state: "complete" } };
		},
		renderCall(args: OracleInput | undefined, theme, context) {
			return renderer.renderCall({ detail: args?.task }, theme, context);
		},
		renderResult(result, options, theme, context) {
			return renderer.renderResult(result, options, theme, context);
		},
	} as ToolDefinition<any, any, any>;
}

export function registerOracle(pi: ExtensionAPI, profiles: ResolvedProfiles, activeMode: ActiveMode): void {
	pi.registerTool(createOracleTool(new SubagentRunner(), profiles, activeMode));
}
