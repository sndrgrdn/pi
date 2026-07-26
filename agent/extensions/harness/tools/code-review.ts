/**
 * Code Review — the fast review tier: one main reviewer child resolves an
 * explicitly described diff and runs applicable Checks through `run_check`;
 * results merge mechanically into one deterministic Comment list.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type AgentToolRecovery, type AgentToolSpec, createAgentTool } from "../agent-tool.ts";
import { type CheckDefinition, checkDirectories, discoverChecks } from "../check-discovery.ts";
import { escapeAttribute } from "../markup.ts";
import type { ResolvedProfiles } from "../profiles.ts";
import { isSubagentAbortError, type SubagentRunner } from "../runner.ts";
import { createShellToolbox, SHELL_TOOLBOX_NAMES } from "../shell/toolbox.ts";
import { type CheckCatalogEntry, CheckCoordinator, type CheckRunParams } from "./code-review-checks.ts";
import {
	commentFromSubmission,
	type ReviewComment,
	reviewSeverities,
	type SubmittedComment,
	submittedCommentSchema,
} from "./review-comment.ts";

interface CodeReviewParams {
	diff_description: string;
	files?: string[];
	instructions?: string;
	thinking?: "low" | "high";
}

interface CodeReviewOptions {
	globalRoots?: readonly string[];
}

/** The deterministic output contract: order by file, severity (low last), location, text. */
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

function reviewMessage(params: CodeReviewParams, checks: readonly CheckDefinition[]): string {
	return [
		`Diff description: ${params.diff_description}`,
		params.files?.length ? `Focus files: ${params.files.join(", ")}` : undefined,
		params.instructions ? `Additional instructions: ${params.instructions}` : undefined,
		"Also discover any additional applicable .agents/checks/*.md files for the changed paths and call run_check once for each applicable Check.",
		'Use this argument shape: { "checkName": "...", "checkURI": "file://...", "diffDescription": "...", "files": ["..."], "instructions": "..." }.',
		"For diffDescription, pass the exact commands you used to resolve the diff so Checks skip re-deriving them.",
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
	const spec: AgentToolSpec<CodeReviewParams, "review"> = {
		key: "review",
		name: "code_review",
		description:
			"Run a formal Code Review only when the user explicitly requests one. Never use merely to inspect changes for context. Uncommitted or staged work, named refs, and explicit ranges are unambiguous: call directly. Ask the user only when the review needs a merge base nobody named; never assume main or master.",
		parameters: Type.Object({
			diff_description: Type.String({ description: "Explicit free-text description of the diff to review." }),
			files: Type.Optional(Type.Array(Type.String())),
			instructions: Type.Optional(Type.String()),
			thinking: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("high")])),
		}),
		route(params) {
			const route = profiles.agents.review.main;
			return { ...route, reasoning: params.thinking ?? route.reasoning };
		},
		async plan(params, ctx) {
			const checks = await discoverChecks({ cwd: ctx.cwd, globalRoots: options.globalRoots });
			const coordinator = new CheckCoordinator(checks, {
				runner,
				profiles,
				cwd: ctx.cwd,
				allowedDirectories: checkDirectories({ cwd: ctx.cwd, globalRoots: options.globalRoots }),
				signal: ctx.signal,
				...(ctx.parentSession ? { parentSession: ctx.parentSession } : {}),
			});
			let submission: ReviewComment[] | undefined;
			const submitReview: ToolDefinition<any, any, any> = {
				name: "submit_review",
				label: "submit_review",
				description: "Submit the complete Code Review and terminate.",
				parameters: Type.Object({ comments: Type.Array(submittedCommentSchema) }),
				async execute(_toolCallID, input: { comments: SubmittedComment[] }) {
					submission = structuredClone(input.comments).map(commentFromSubmission);
					return { content: [{ type: "text", text: "Review submitted." }], details: {}, terminate: true } as any;
				},
			};
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
					const summary = await coordinator.run(input);
					return { content: [{ type: "text", text: summary }], details: {} } as any;
				},
			};
			return {
				systemPrompt,
				message: reviewMessage(params, checks),
				toolbox: (processes) => [...createShellToolbox(processes), runCheck, submitReview],
				finalize: () => {
					if (!submission) throw new Error("review child did not submit a review");
					return { content: formatReview([...submission, ...coordinator.comments()], coordinator.entries()) };
				},
				recover: (error): AgentToolRecovery => ({
					content: [
						`Review failed: ${error instanceof Error ? error.message : String(error)}`,
						"",
						formatReview([...(submission ?? []), ...coordinator.comments()], coordinator.entries()),
					].join("\n"),
					outcome: isSubagentAbortError(error) ? "cancelled" : "failed",
				}),
			};
		},
		finalize(answer) {
			// Unreached in practice: every plan supplies a capture-based finalize. Identity keeps the spec total.
			return { content: answer };
		},
		presentation: { action: "review", target: (params) => params.diff_description },
		tools: ["read", "grep", "find", "ls", ...SHELL_TOOLBOX_NAMES, "run_check", "submit_review"],
		allowMcp: false,
	};
	return createAgentTool(spec, runner);
}
