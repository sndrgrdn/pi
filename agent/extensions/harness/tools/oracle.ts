import { readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type AgentToolSpec, createAgentTool } from "../agent-tool.ts";
import type { ResolvedProfiles } from "../profiles.ts";
import type { SubagentRunner } from "../runner.ts";
import { createShellToolbox, SHELL_TOOLBOX_NAMES } from "../shell/toolbox.ts";
import { createFinderTool } from "./finder.ts";
import { createLibrarianTool } from "./librarian.ts";

const prompt = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), "..", "agents", "prompts", "oracle.md"),
	"utf8",
).trim();

interface OracleParams {
	task: string;
	context?: string;
	files?: string[];
}

function oracleMessage(params: OracleParams, cwd: string): string {
	const sections = [`Task: ${params.task}`];
	if (params.context) sections.push(`Context: ${params.context}`);
	for (const path of params.files ?? []) {
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

export function createOracleTool(
	runner: Pick<SubagentRunner, "run">,
	profiles: ResolvedProfiles,
): ToolDefinition<any, any, any> {
	const spec: AgentToolSpec<OracleParams, "oracle"> = {
		key: "oracle",
		name: "oracle",
		description:
			"Consult a read-only senior advisor for an independent second opinion on a bounded, high-judgment review, cross-module bug, architecture or plan tradeoff, or API/type design. Use Finder for location and Librarian for external research.",
		parameters: Type.Object({
			task: Type.String({ description: "Bounded question or decision the advisor should resolve." }),
			context: Type.Optional(Type.String({ description: "Constraints, desired outcome, and relevant background." })),
			files: Type.Optional(
				Type.Array(Type.String(), { description: "Specific files to include as direct evidence." }),
			),
		}),
		route: () => profiles.agents.oracle,
		plan: (params, ctx) => ({
			systemPrompt: `${prompt}\n\nWorking directory: ${ctx.cwd}\nCurrent date: ${new Date().toISOString().slice(0, 10)}`,
			message: oracleMessage(params, ctx.cwd),
			toolbox: (processes) => [
				...createShellToolbox(processes),
				createFinderTool(runner, profiles),
				createLibrarianTool(runner, profiles),
			],
		}),
		finalize: (answer) => {
			if (!answer.trim()) throw new Error("Oracle child returned an empty final message");
			return { content: answer };
		},
		presentation: { action: "oracle", target: (params) => params.task },
		tools: [...SHELL_TOOLBOX_NAMES, "finder", "librarian"],
		allowMcp: false,
	};
	return createAgentTool(spec, runner);
}
