import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { buildEnvelope } from "../envelopes.ts";
import { createApplyPatchTool } from "../patch/tool.ts";
import { type Mode, type ResolvedProfiles, resolveAgentRoute, TASK_POSTURE } from "../profiles.ts";
import { projectContextPrompt } from "../project-context.ts";
import { AGENT_TOOLBOX_MATRIX, resolveAgentDefinition } from "../registry.ts";
import { SubagentAbortError, SubagentRunError, type SubagentRunner, type ToolLogEntry } from "../runner.ts";
import { createShellCancelTool } from "../shell/cancel.ts";
import { createShellCommandTool } from "../shell/command.ts";
import { createShellStatusTool } from "../shell/status.ts";
import { createChildSkillTool, discoverChildSkills } from "../skill/child.ts";
import { buildDirective, extractSkillRefs } from "../skill/core.ts";
import { createProgressSignal, createSubagentRenderer } from "../ui/subagent.ts";
import { type TraceState, withTraceDetails } from "../ui/trace.ts";
import { createFinderTool } from "./finder.ts";
import { createLibrarianTool } from "./librarian.ts";
import { createHarnessReadTool } from "./read.ts";

const renderer = createSubagentRenderer<TaskInput>({
	action: (args) => `task (${args.mode ?? "low"})`,
	target: (args) => args.description,
});

export interface TaskInput {
	prompt: string;
	description: string;
	mode?: Mode;
}
export interface TaskPromptParts {
	system: string;
	appendSystem: string;
	projectContext: string;
	modePosture: string;
	taskPosture: string;
}
export type TaskToolLogEntry = ToolLogEntry;

function cappedLines(value: string, cap: number): string {
	return value.split("\n").slice(0, cap).join("\n");
}

export function buildCancellationReport(log: readonly TaskToolLogEntry[]): string {
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

function readBasePrompts(cwd: string): Pick<TaskPromptParts, "system" | "appendSystem" | "projectContext"> {
	const agentDir = getAgentDir();
	return {
		system: readFileSync(join(agentDir, "SYSTEM.md"), "utf8"),
		appendSystem: readFileSync(join(agentDir, "APPEND_SYSTEM.md"), "utf8"),
		projectContext: projectContextPrompt(cwd),
	};
}

export interface TaskDependencies {
	basePrompts?: (
		cwd: string,
	) =>
		| Pick<TaskPromptParts, "system" | "appendSystem" | "projectContext">
		| Promise<Pick<TaskPromptParts, "system" | "appendSystem" | "projectContext">>;
}

export function createTaskTool(
	runner: Pick<SubagentRunner, "run">,
	profiles: ResolvedProfiles,
	dependencies: TaskDependencies = {},
): ToolDefinition<any, any, any> {
	return {
		name: "task",
		label: "task",
		description:
			"Delegate a bounded mutation. Specify verification steps; summarize the returned report for the user.",
		parameters: Type.Object({
			prompt: Type.String({
				description: "Complete implementation brief, including constraints and verification steps.",
			}),
			description: Type.String({ description: "Short TUI description of the delegated work." }),
			mode: Type.Optional(
				Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")], {
					description: "Route: low = Sol/low; medium = Sol/high; high = Fable 5/high. Defaults to low.",
				}),
			),
		}),
		renderShell: "self",
		async execute(_id, params: TaskInput, signal, onUpdate, ctx) {
			const mode = params.mode ?? "low";
			const recordAction = createProgressSignal(onUpdate, { mode, description: params.description });
			const base = await (dependencies.basePrompts ?? readBasePrompts)(ctx.cwd);
			const skills = discoverChildSkills(ctx.cwd);
			const refs = extractSkillRefs(
				params.prompt,
				skills.map((skill) => skill.name),
			);
			const systemPrompt = [
				base.system,
				base.appendSystem,
				base.projectContext,
				profiles.modes[mode].posture,
				TASK_POSTURE,
			]
				.filter(Boolean)
				.join("\n\n");
			const definition = resolveAgentDefinition(
				{
					key: "task",
					...AGENT_TOOLBOX_MATRIX.task,
					systemPrompt,
				},
				resolveAgentRoute(profiles, "task", mode),
			);
			let envelope: string;
			let outcome: TraceState = "success";
			try {
				envelope = await runner.run({
					definition,
					cwd: ctx.cwd,
					input: params,
					signal,
					onAction: recordAction,
					toolbox: (processes) => [
						createShellCommandTool(processes),
						createShellStatusTool(processes),
						createShellCancelTool(processes),
						createHarnessReadTool(),
						createApplyPatchTool(),
						createChildSkillTool(skills),
						createFinderTool(runner, profiles),
						createLibrarianTool(runner, profiles),
					],
					mapInput: (input) => (refs.length ? `${buildDirective(refs)}\n\n${input.prompt}` : input.prompt),
					wrapResult: (sessionID, content) => buildEnvelope({ kind: "task", sessionID, content }),
				});
			} catch (error) {
				if (error instanceof SubagentAbortError) {
					if (!error.sessionID) throw error;
					outcome = "cancelled";
					envelope = buildEnvelope({
						kind: "task_error",
						sessionID: error.sessionID,
						content: buildCancellationReport(error.toolLog),
					});
				} else {
					if (!(error instanceof SubagentRunError)) throw error;
					const failure = error;
					outcome = "failed";
					try {
						const summary = await runner.run({
							definition: resolveAgentDefinition(
								{
									key: "task",
									allowMcp: false,
									tools: [],
									systemPrompt:
										"Summarize a failed Task run from its tool log. Report accomplishments, files modified, findings, verification, and unfinished work. Do not invent facts.",
								},
								resolveAgentRoute(profiles, "task", mode),
							),
							cwd: ctx.cwd,
							input: JSON.stringify({ error: failure.message, toolLog: failure.toolLog }),
							mapInput: String,
							wrapResult: (_sessionID, content) => content,
							signal,
						});
						envelope = buildEnvelope({ kind: "task_error", sessionID: failure.sessionID, content: summary });
					} catch (summaryError) {
						if (!(summaryError instanceof SubagentAbortError) || !summaryError.sessionID) throw summaryError;
						outcome = "cancelled";
						envelope = buildEnvelope({
							kind: "task_error",
							sessionID: failure.sessionID,
							content: buildCancellationReport(failure.toolLog),
						});
					}
				}
			}
			return {
				content: [{ type: "text", text: envelope }],
				details: withTraceDetails({ mode, description: params.description }, outcome),
			};
		},
		renderCall: renderer.renderCall,
		renderResult: renderer.renderResult,
	} as ToolDefinition<any, any, any>;
}
