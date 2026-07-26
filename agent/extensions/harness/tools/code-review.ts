import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type CheckDefinition, discoverChecks, loadCheck } from "../check-discovery.ts";
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
	source?: string;
	why?: string;
	fix?: string;
}
interface CheckIssue {
	severity: Severity;
	file: string;
	line?: number;
	endLine?: number;
	problem: string;
	why?: string;
	fix?: string;
}
interface CheckRunParams {
	checkName: string;
	checkURI: string;
	diffDescription: string;
	files?: string[];
	instructions: string;
}
type CheckStatus = { state: "ran"; count: number } | { state: "error" } | { state: "not-run" };
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
	severity: Type.Union(severities.map((severity) => Type.Literal(severity))),
	text: Type.String(),
	why: Type.Optional(Type.String()),
	fix: Type.Optional(Type.String()),
});

const checkIssueSchema = Type.Object({
	severity: Type.Union(severities.map((severity) => Type.Literal(severity))),
	file: Type.String(),
	line: Type.Optional(Type.Integer({ minimum: 1 })),
	endLine: Type.Optional(Type.Integer({ minimum: 1 })),
	problem: Type.String(),
	why: Type.Optional(Type.String()),
	fix: Type.Optional(Type.String()),
});

function formatReview(
	comments: readonly Comment[],
	checks: readonly CheckDefinition[],
	statuses: ReadonlyMap<string, CheckStatus> = new Map(),
): string {
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
		lines.push(
			`- **${comment.severity.toUpperCase()}** ${location} — ${comment.source ? `[${comment.source}] ` : ""}${comment.text}`,
		);
		if (comment.why) lines.push(`  - Why: ${comment.why}`);
		if (comment.fix) lines.push(`  - Fix: ${comment.fix}`);
	}
	lines.push("", "## Checks");
	if (!checks.length) lines.push("No checks were run.");
	for (const check of checks) {
		const status = statuses.get(check.name) ?? { state: "not-run" };
		const label =
			status.state === "ran" ? `ran with ${status.count} ${status.count === 1 ? "issue" : "issues"}` : status.state;
		lines.push(`- ${check.name} — **${label}**`);
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

const checkSystemPrompt = `You run one Code Review Check against an explicitly described diff.
Inspect only; never modify files. Follow the supplied Check instructions and report only issues caused by the diff.
Finish by calling submit_check exactly once. Do not write a final assistant message.`;

function checkMessage(params: CheckRunParams, check: CheckDefinition): string {
	return [
		`Check: ${check.name}`,
		check.description ? `Description: ${check.description}` : undefined,
		`Diff description: ${params.diffDescription}`,
		params.files?.length ? `Relevant files: ${params.files.join(", ")}` : undefined,
		`Invocation brief: ${params.instructions}`,
		"Check instructions:",
		check.body,
	]
		.filter((line) => line !== undefined)
		.join("\n\n");
}

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
			let submission: Comment[] | undefined;
			let checks: CheckDefinition[] = [];
			const checkStatuses = new Map<string, CheckStatus>();
			const checkComments: Comment[] = [];
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
				checks = await discoverChecks({ cwd: ctx.cwd, globalRoots: options.globalRoots });
				for (const check of checks) checkStatuses.set(check.name, { state: "not-run" });
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
						let check = checks.find((candidate) => pathToFileURL(candidate.path).href === input.checkURI);
						if (!check) {
							let path: string;
							try {
								const uri = new URL(input.checkURI);
								if (uri.protocol !== "file:") throw new Error("not file");
								path = fileURLToPath(uri);
							} catch {
								const valid = checks
									.map((candidate) => `${candidate.name}: ${pathToFileURL(candidate.path).href}`)
									.join(", ");
								throw new Error(
									`Unknown Check URI ${JSON.stringify(input.checkURI)}. Valid Checks: ${valid || "none"}`,
								);
							}
							try {
								check = await loadCheck(path);
							} catch (error) {
								throw new Error(
									`Could not load Check ${input.checkURI}: ${error instanceof Error ? error.message : String(error)}`,
								);
							}
							if (!check) throw new Error(`Check ${input.checkURI} has no instructions`);
							checks.push(check);
							checkStatuses.set(check.name, { state: "not-run" });
						}

						let issues: CheckIssue[] | undefined;
						let lastError: unknown;
						for (let attempt = 0; attempt < 2; attempt++) {
							issues = undefined;
							const submitCheck: ToolDefinition<any, any, any> = {
								name: "submit_check",
								label: "submit_check",
								description: "Submit all Check issues and terminate.",
								parameters: Type.Object({ issues: Type.Array(checkIssueSchema) }),
								async execute(_id, value: { issues: CheckIssue[] }) {
									issues = structuredClone(value.issues);
									return {
										content: [{ type: "text", text: "Check submitted." }],
										details: {},
										terminate: true,
									} as any;
								},
							};
							try {
								const checkRoute = profiles.agents.review.check;
								await runner.run({
									definition: {
										key: "review",
										systemPrompt: checkSystemPrompt,
										tools: ["read", "grep", "find", "ls", ...SHELL_TOOLBOX_NAMES, "submit_check"],
										allowMcp: false,
										model: checkRoute.model,
										reasoningEffort: checkRoute.reasoning,
									},
									cwd: ctx.cwd,
									message: checkMessage(input, check),
									signal,
									...(parentSession
										? { record: { parentSession, name: `check: ${check.name}`.slice(0, 120) } }
										: {}),
									toolbox: (processes) => [...createShellToolbox(processes), submitCheck],
								});
								if (!issues) throw new Error("check child did not submit a check");
								lastError = undefined;
								break;
							} catch (error) {
								if (isSubagentAbortError(error)) throw error;
								if (issues && /returned no final message/.test(error instanceof Error ? error.message : "")) {
									lastError = undefined;
									break;
								}
								lastError = error;
							}
						}
						if (lastError || !issues) {
							checkStatuses.set(check.name, { state: "error" });
							return { content: [{ type: "text", text: `${check.name} error.` }], details: {} } as any;
						}
						for (const issue of issues) {
							checkComments.push({
								filename: issue.file,
								startLine: issue.line ?? 1,
								endLine: issue.endLine ?? issue.line ?? 1,
								severity: issue.severity,
								text: issue.problem,
								source: check.name,
								why: issue.why,
								fix: issue.fix,
							});
						}
						checkStatuses.set(check.name, { state: "ran", count: issues.length });
						return {
							content: [
								{
									type: "text",
									text: `${check.name} ran with ${issues.length} ${issues.length === 1 ? "issue" : "issues"}.`,
								},
							],
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
								content: formatReview([...submission, ...checkComments], checks, checkStatuses),
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
								text: buildEnvelope({
									kind: "review",
									sessionID,
									content: formatReview([...submission, ...checkComments], checks, checkStatuses),
								}),
							},
						],
						details: withTraceDetails(traceDetails(), "success"),
					};
				const attributedSessionID = sessionID ?? "unavailable";
				const content = [
					`Review failed: ${error instanceof Error ? error.message : String(error)}`,
					"",
					formatReview([...(submission ?? []), ...checkComments], checks, checkStatuses),
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
