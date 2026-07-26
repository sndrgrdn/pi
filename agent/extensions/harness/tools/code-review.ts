import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type CheckDefinition, discoverChecks } from "../check-discovery.ts";
import { buildEnvelope } from "../envelopes.ts";
import type { ResolvedProfiles } from "../profiles.ts";
import { isSubagentAbortError, SubagentRunError, type SubagentRunner } from "../runner.ts";
import { createShellToolbox, SHELL_TOOLBOX_NAMES } from "../shell/toolbox.ts";
import { createTraceRenderer, emitTraceRunning, withTraceDetails } from "../ui/trace.ts";
import {
	type CheckCatalogEntry,
	CheckCoordinator,
	type CheckRunParams,
	type ReviewComment,
	reviewSeverities,
} from "./code-review-checks.ts";

interface SubmittedComment {
	filename: string;
	startLine: number;
	endLine: number;
	severity: (typeof reviewSeverities)[number];
	text: string;
	why?: string;
	fix?: string;
}
interface CodeReviewParams {
	diff_description: string;
	files?: string[];
	instructions?: string;
	thinking?: "low" | "high";
}
interface CodeReviewOptions {
	globalRoots?: readonly string[];
}

const commentSchema = Type.Object({
	filename: Type.String(),
	startLine: Type.Integer({ minimum: 1 }),
	endLine: Type.Integer({ minimum: 1 }),
	severity: Type.Union(reviewSeverities.map((severity) => Type.Literal(severity))),
	text: Type.String(),
	why: Type.Optional(Type.String()),
	fix: Type.Optional(Type.String()),
});

function formatReview(comments: readonly ReviewComment[], checks: readonly CheckCatalogEntry[]): string {
	const ordered = [...comments].sort(
		(a, b) =>
			a.filename.localeCompare(b.filename) ||
			reviewSeverities.indexOf(a.severity) - reviewSeverities.indexOf(b.severity) ||
			(a.location?.startLine ?? Number.MAX_SAFE_INTEGER) - (b.location?.startLine ?? Number.MAX_SAFE_INTEGER) ||
			(a.location?.endLine ?? Number.MAX_SAFE_INTEGER) - (b.location?.endLine ?? Number.MAX_SAFE_INTEGER) ||
			a.text.localeCompare(b.text),
	);
	const lines = ["## Comments", ""];
	if (!ordered.length) lines.push("No comments.");
	let filename: string | undefined;
	for (const comment of ordered) {
		if (filename !== comment.filename) {
			if (filename !== undefined) lines.push("");
			filename = comment.filename;
			lines.push(`### ${filename}`);
		}
		const location = comment.location
			? comment.location.startLine === comment.location.endLine
				? `line ${comment.location.startLine} — `
				: `lines ${comment.location.startLine}-${comment.location.endLine} — `
			: "— ";
		lines.push(
			`- **${comment.severity.toUpperCase()}** ${location}${comment.source ? `[${comment.source}] ` : ""}${comment.text}`,
		);
		if (comment.why) lines.push(`  - Why: ${comment.why}`);
		if (comment.fix) lines.push(`  - Fix: ${comment.fix}`);
	}
	lines.push("", "## Checks");
	if (!checks.length) lines.push("No checks were run.");
	const nameCounts = new Map<string, number>();
	for (const check of checks) nameCounts.set(check.definition.name, (nameCounts.get(check.definition.name) ?? 0) + 1);
	for (const check of checks) {
		const status = check.status;
		const label =
			status.state === "ran" ? `ran with ${status.count} ${status.count === 1 ? "issue" : "issues"}` : status.state;
		const identity = (nameCounts.get(check.definition.name) ?? 0) > 1 ? ` (${check.uri})` : "";
		lines.push(`- ${check.definition.name}${identity} — **${label}**`);
	}
	return lines.join("\n");
}

function escapeAttribute(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function reviewMessage(params: CodeReviewParams, checks: readonly CheckDefinition[]): string {
	return [
		`Diff description: ${params.diff_description}`,
		params.files?.length ? `Focus files: ${params.files.join(", ")}` : undefined,
		params.instructions ? `Additional instructions: ${params.instructions}` : undefined,
		"Also discover any additional applicable .agents/checks/*.md files for the changed paths and call run_check once for each applicable Check.",
		'Use this argument shape: { "checkName": "...", "checkURI": "file://...", "diffDescription": "...", "files": ["..."], "instructions": "..." }.',
		checks.length
			? [
					"Pre-discovered Checks:",
					...checks.map((check) =>
						[
							`<check name="${escapeAttribute(check.name)}" severity-default="${escapeAttribute(check.severityDefault)}" uri="${escapeAttribute(pathToFileURL(check.path).href)}">`,
							check.description ? `Description: ${check.description}` : undefined,
							check.description ? "" : undefined,
							check.body,
							"</check>",
						]
							.filter((line) => line !== undefined)
							.join("\n"),
					),
				].join("\n\n")
			: "No Checks were pre-discovered.",
	]
		.filter(Boolean)
		.join("\n\n");
}

const systemPrompt = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), "..", "agents", "prompts", "review.md"),
	"utf8",
).trim();

export function createCodeReviewTool(
	runner: Pick<SubagentRunner, "run">,
	profiles: ResolvedProfiles,
	options: CodeReviewOptions = {},
): ToolDefinition<any, any, any> {
	const renderer = createTraceRenderer<CodeReviewParams>({
		invocation: (params) => ({ action: "review", target: params.diff_description }),
		progress: (result) => {
			if (typeof result.details !== "object" || result.details === null) return [];
			const counts = (result.details as { toolCallCounts?: Record<string, number> }).toolCallCounts;
			if (!counts) return [];
			const tally = Object.entries(counts)
				.map(([name, count]) => `${name} ×${count}`)
				.join(", ");
			return tally ? [tally] : [];
		},
	});
	return {
		name: "code_review",
		label: "code_review",
		description:
			"Run a formal Code Review only when the user explicitly requests one. Never use merely to inspect changes for context. If the merge base is ambiguous, ask the user first; never assume main or master.",
		parameters: Type.Object({
			diff_description: Type.String({ description: "Explicit free-text description of the diff to review." }),
			files: Type.Optional(Type.Array(Type.String())),
			instructions: Type.Optional(Type.String()),
			thinking: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("high")])),
		}),
		renderShell: "self",
		async execute(_id, params: CodeReviewParams, signal, onUpdate, ctx) {
			const toolCallCounts = new Map<string, number>();
			const toolCalls: string[] = [];
			const traceDetails = () => ({ toolCallCounts: Object.fromEntries(toolCallCounts), toolCalls: [...toolCalls] });
			emitTraceRunning(onUpdate, traceDetails());
			let submission: ReviewComment[] | undefined;
			let checks: CheckDefinition[] = [];
			let coordinator: CheckCoordinator | undefined;
			const submitReview: ToolDefinition<any, any, any> = {
				name: "submit_review",
				label: "submit_review",
				description: "Submit the complete Code Review and terminate.",
				parameters: Type.Object({ comments: Type.Array(commentSchema) }),
				async execute(_toolCallID, input: { comments: SubmittedComment[] }) {
					submission = structuredClone(input.comments).map((comment) => ({
						filename: comment.filename,
						location: { startLine: comment.startLine, endLine: comment.endLine },
						severity: comment.severity,
						text: comment.text,
						why: comment.why,
						fix: comment.fix,
					}));
					return { content: [{ type: "text", text: "Review submitted." }], details: {}, terminate: true } as any;
				},
			};
			const route = profiles.agents.review.main;
			const parentSession = ctx.sessionManager?.getSessionFile();
			try {
				checks = await discoverChecks({ cwd: ctx.cwd, globalRoots: options.globalRoots });
				const activeCoordinator = new CheckCoordinator(checks, {
					runner,
					profiles,
					cwd: ctx.cwd,
					signal,
					...(parentSession ? { parentSession } : {}),
				});
				coordinator = activeCoordinator;
				const runCheck: ToolDefinition<any, any, any> = {
					name: "run_check",
					label: "run_check",
					description: "Run one discovered Code Review Check. Returns only a one-line summary.",
					parameters: Type.Object({
						checkName: Type.String(),
						checkURI: Type.String(),
						diffDescription: Type.String(),
						files: Type.Optional(Type.Array(Type.String())),
						instructions: Type.String(),
					}),
					async execute(_toolCallID, input: CheckRunParams) {
						const summary = await activeCoordinator.run(input);
						return {
							content: [{ type: "text", text: summary }],
							details: {},
						} as any;
					},
				};
				const child = await runner.run({
					definition: {
						key: "review",
						systemPrompt,
						tools: ["read", "grep", "find", "ls", ...SHELL_TOOLBOX_NAMES, "run_check", "submit_review"],
						allowMcp: false,
						model: route.model,
						reasoningEffort: params.thinking ?? route.reasoning,
					},
					cwd: ctx.cwd,
					message: reviewMessage(params, checks),
					finalMessage: "optional",
					signal,
					...(parentSession
						? { record: { parentSession, name: `review: ${params.diff_description}`.slice(0, 120) } }
						: {}),
					onToolCall: (toolCall) => {
						toolCallCounts.set(toolCall.tool, (toolCallCounts.get(toolCall.tool) ?? 0) + 1);
						toolCalls.push(toolCall.summary);
						emitTraceRunning(onUpdate, traceDetails());
					},
					toolbox: (processes) => [...createShellToolbox(processes), runCheck, submitReview],
				});
				if (!submission)
					throw new SubagentRunError(
						child.sessionID,
						child.toolLog,
						new Error("review child did not submit a review"),
					);
				return {
					content: [
						{
							type: "text",
							text: buildEnvelope({
								kind: "review",
								sessionID: child.sessionID,
								content: formatReview(
									[...submission, ...activeCoordinator.comments()],
									activeCoordinator.entries(),
								),
							}),
						},
					],
					details: withTraceDetails(traceDetails(), "success"),
				};
			} catch (error) {
				if (isSubagentAbortError(error)) throw error;
				const sessionID = error instanceof SubagentRunError ? error.sessionID : undefined;
				const attributedSessionID = sessionID ?? "unavailable";
				const content = [
					`Review failed: ${error instanceof Error ? error.message : String(error)}`,
					"",
					formatReview([...(submission ?? []), ...(coordinator?.comments() ?? [])], coordinator?.entries() ?? []),
				].join("\n");
				return {
					content: [
						{
							type: "text",
							text: buildEnvelope({ kind: "error", agent: "review", sessionID: attributedSessionID, content }),
						},
					],
					details: withTraceDetails(traceDetails(), "failed"),
				};
			}
		},
		renderCall: renderer.renderCall,
		renderResult: renderer.renderResult,
	} as ToolDefinition<any, any, any>;
}
