import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { buildEnvelope } from "../envelopes.ts";
import type { ResolvedProfiles } from "../profiles.ts";
import { isSubagentAbortError, SubagentRunError, type SubagentRunner } from "../runner.ts";
import { createShellToolbox, SHELL_TOOLBOX_NAMES } from "../shell/toolbox.ts";
import { createTraceRenderer, emitTraceRunning, withTraceDetails } from "../ui/trace.ts";

const severities = ["critical", "high", "medium", "low"] as const;
type Severity = (typeof severities)[number];
interface Comment {
	filename: string;
	startLine: number;
	endLine: number;
	severity: Severity;
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

const commentSchema = Type.Object({
	filename: Type.String(),
	startLine: Type.Integer({ minimum: 1 }),
	endLine: Type.Integer({ minimum: 1 }),
	severity: Type.Union(severities.map((severity) => Type.Literal(severity))),
	text: Type.String(),
	why: Type.Optional(Type.String()),
	fix: Type.Optional(Type.String()),
});

function formatReview(comments: readonly Comment[]): string {
	const ordered = [...comments].sort(
		(a, b) =>
			a.filename.localeCompare(b.filename) ||
			severities.indexOf(a.severity) - severities.indexOf(b.severity) ||
			a.startLine - b.startLine ||
			a.endLine - b.endLine ||
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
		const location =
			comment.startLine === comment.endLine
				? `line ${comment.startLine}`
				: `lines ${comment.startLine}-${comment.endLine}`;
		lines.push(`- **${comment.severity.toUpperCase()}** ${location} — ${comment.text}`);
		if (comment.why) lines.push(`  - Why: ${comment.why}`);
		if (comment.fix) lines.push(`  - Fix: ${comment.fix}`);
	}
	lines.push("", "## Checks", "No checks were run.");
	return lines.join("\n");
}

function reviewMessage(params: CodeReviewParams): string {
	return [
		`Diff description: ${params.diff_description}`,
		params.files?.length ? `Focus files: ${params.files.join(", ")}` : undefined,
		params.instructions ? `Additional instructions: ${params.instructions}` : undefined,
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
			let submission: Comment[] | undefined;
			const submitReview: ToolDefinition<any, any, any> = {
				name: "submit_review",
				label: "submit_review",
				description: "Submit the complete Code Review and terminate.",
				parameters: Type.Object({ comments: Type.Array(commentSchema) }),
				async execute(_toolCallID, input: { comments: Comment[] }) {
					submission = structuredClone(input.comments);
					return { content: [{ type: "text", text: "Review submitted." }], details: {}, terminate: true } as any;
				},
			};
			const route = profiles.agents.review.main;
			const parentSession = ctx.sessionManager?.getSessionFile();
			try {
				const child = await runner.run({
					definition: {
						key: "review",
						systemPrompt,
						tools: ["read", "grep", "find", "ls", ...SHELL_TOOLBOX_NAMES, "submit_review"],
						allowMcp: false,
						model: route.model,
						reasoningEffort: params.thinking ?? route.reasoning,
					},
					cwd: ctx.cwd,
					message: reviewMessage(params),
					signal,
					...(parentSession
						? { record: { parentSession, name: `review: ${params.diff_description}`.slice(0, 120) } }
						: {}),
					onToolCall: (toolCall) => {
						toolCallCounts.set(toolCall.tool, (toolCallCounts.get(toolCall.tool) ?? 0) + 1);
						toolCalls.push(toolCall.summary);
						emitTraceRunning(onUpdate, traceDetails());
					},
					toolbox: (processes) => [...createShellToolbox(processes), submitReview],
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
								content: formatReview(submission),
							}),
						},
					],
					details: withTraceDetails(traceDetails(), "success"),
				};
			} catch (error) {
				if (isSubagentAbortError(error)) throw error;
				const sessionID = error instanceof SubagentRunError ? error.sessionID : undefined;
				if (
					submission &&
					sessionID &&
					/returned no final message/.test(error instanceof Error ? error.message : "")
				)
					return {
						content: [
							{
								type: "text",
								text: buildEnvelope({ kind: "review", sessionID, content: formatReview(submission) }),
							},
						],
						details: withTraceDetails(traceDetails(), "success"),
					};
				const attributedSessionID = sessionID ?? "unavailable";
				const content = [
					`Review failed: ${error instanceof Error ? error.message : String(error)}`,
					"",
					formatReview(submission ?? []),
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
