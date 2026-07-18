import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	type AgentToolRecoverContext,
	type AgentToolRecovery,
	type AgentToolSpec,
	createAgentTool,
} from "../agent-tool.ts";
import { createApplyPatchTool } from "../patch/tool.ts";
import { type ResolvedProfiles, TASK_EFFORTS, type TaskEffort } from "../profiles.ts";
import { projectContextPrompt } from "../project-context.ts";
import { isSubagentAbortError, SubagentRunError, type SubagentRunner, type ToolLogEntry } from "../runner.ts";
import { createShellToolbox, SHELL_TOOLBOX_NAMES } from "../shell/toolbox.ts";
import { createFinderTool } from "./finder.ts";
import { createLibrarianTool } from "./librarian.ts";
import { createHarnessReadTool } from "./read.ts";

const workerPrompt = readFileSync(join(import.meta.dirname, "..", "agents", "prompts", "task.md"), "utf8").trim();

interface TaskInput {
	prompt: string;
	description: string;
	effort?: TaskEffort;
}

export interface TaskBasePrompts {
	system: string;
	appendSystem: string;
	projectContext: string;
}

function taskEffort(params: TaskInput): TaskEffort {
	return params.effort ?? "standard";
}

function cappedLines(value: string, cap: number): string {
	return value.split("\n").slice(0, cap).join("\n");
}

function buildCancellationReport(log: readonly ToolLogEntry[]): string {
	const completed: string[] = [];
	const pending: string[] = [];
	for (const entry of log) {
		const command = typeof entry.input?.command === "string" ? entry.input.command : undefined;
		const patch = typeof entry.input?.patch === "string" ? entry.input.patch : undefined;
		const path = typeof entry.input?.path === "string" ? entry.input.path : undefined;
		const label = command
			? `Command: ${command.slice(0, 80)}${command.length > 80 ? "…" : ""}`
			: `${entry.tool}${path ? `: ${path}` : ""}`;
		if (entry.output === undefined) {
			pending.push(`- ${label}`);
			continue;
		}
		const evidence = patch ? cappedLines(patch, 20) : cappedLines(entry.output, 10);
		completed.push(`- ${label}${entry.isError ? " (failed)" : ""}${evidence ? `\n\n${evidence}` : ""}`);
	}
	return [
		"Task was cancelled.",
		"## Completed work",
		completed.join("\n\n") || "- None recorded.",
		"## In progress when cancelled",
		pending.join("\n") || "- Nothing recorded.",
	].join("\n\n");
}

function readBasePrompts(cwd: string): TaskBasePrompts {
	const agentDir = getAgentDir();
	return {
		system: readFileSync(join(agentDir, "SYSTEM.md"), "utf8"),
		appendSystem: readFileSync(join(agentDir, "APPEND_SYSTEM.md"), "utf8"),
		projectContext: projectContextPrompt(cwd),
	};
}

export interface TaskDependencies {
	basePrompts?: (cwd: string) => TaskBasePrompts | Promise<TaskBasePrompts>;
}

const SUMMARY_SYSTEM_PROMPT =
	"Summarize a failed Task run using only facts in its tool log. Report accomplishments, files modified, findings, verification, and unfinished work.";

export function createTaskTool(
	runner: Pick<SubagentRunner, "run">,
	profiles: ResolvedProfiles,
	dependencies: TaskDependencies = {},
): ToolDefinition<any, any, any> {
	const taskRoute = (params: TaskInput) => profiles.agents.task[taskEffort(params)];

	/** One cohesive recovery policy: cancellation report, else summary re-run with cancellation fallback. */
	async function recover(
		error: unknown,
		{ params, cwd, signal }: AgentToolRecoverContext<TaskInput>,
	): Promise<AgentToolRecovery> {
		if (isSubagentAbortError(error)) {
			return { content: buildCancellationReport(error.toolLog), outcome: "cancelled" };
		}
		if (!(error instanceof SubagentRunError)) throw error;
		try {
			const route = taskRoute(params);
			const summary = await runner.run({
				definition: {
					key: "task",
					allowMcp: false,
					tools: [],
					systemPrompt: SUMMARY_SYSTEM_PROMPT,
					model: route.model,
					reasoningEffort: route.reasoning,
				},
				cwd,
				message: JSON.stringify({ error: error.message, toolLog: error.toolLog }),
				signal,
			});
			return { content: summary.answer, outcome: "failed" };
		} catch (summaryError) {
			if (!isSubagentAbortError(summaryError) || !summaryError.sessionID) throw summaryError;
			return { content: buildCancellationReport(error.toolLog), outcome: "cancelled" };
		}
	}

	const spec: AgentToolSpec<TaskInput, "task"> = {
		key: "task",
		name: "task",
		description:
			"Delegate a scoped implementation or isolated verification job. Use Finder for codebase discovery, Oracle for a second opinion on an unresolved hard decision, and Librarian for external research.",
		parameters: Type.Object({
			prompt: Type.String({
				description:
					"Self-contained worker brief: outcome, scope, relevant context, constraints and non-goals, and validation.",
			}),
			description: Type.String({ description: "Short TUI label for the delegated work." }),
			effort: Type.Optional(
				Type.Union(
					TASK_EFFORTS.map((effort) => Type.Literal(effort)),
					{
						description:
							"Defaults to standard. Reserve high for exceptional assignments dominated by deep reasoning.",
					},
				),
			),
		}),
		route: taskRoute,
		plan: async (params, ctx) => {
			const base = await (dependencies.basePrompts ?? readBasePrompts)(ctx.cwd);
			return {
				systemPrompt: [base.system, base.appendSystem, base.projectContext, workerPrompt]
					.filter(Boolean)
					.join("\n\n"),
				message: params.prompt,
				toolbox: (processes) => [
					...createShellToolbox(processes),
					createHarnessReadTool(),
					createApplyPatchTool(),
					createFinderTool(runner, profiles),
					createLibrarianTool(runner, profiles),
				],
			};
		},
		finalize: (answer) => ({ content: answer }),
		recover,
		presentation: {
			action: (params) => `task (${taskEffort(params)})`,
			target: (params) => params.description,
		},
		traceDetails: (params) => ({ effort: taskEffort(params), description: params.description }),
		tools: [...SHELL_TOOLBOX_NAMES, "read", "apply_patch", "finder", "librarian"],
		allowMcp: true,
	};
	return createAgentTool(spec, runner);
}
