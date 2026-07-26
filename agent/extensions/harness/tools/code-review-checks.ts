import { fileURLToPath, pathToFileURL } from "node:url";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type CheckDefinition, loadCheck } from "../check-discovery.ts";
import type { ResolvedProfiles } from "../profiles.ts";
import { isSubagentAbortError, type SubagentRunner } from "../runner.ts";
import { createShellToolbox, SHELL_TOOLBOX_NAMES } from "../shell/toolbox.ts";

export const reviewSeverities = ["critical", "high", "medium", "low"] as const;
export type ReviewSeverity = (typeof reviewSeverities)[number];

export interface ReviewLocation {
	startLine: number;
	endLine: number;
}

export interface ReviewComment {
	filename: string;
	location?: ReviewLocation;
	severity: ReviewSeverity;
	text: string;
	source?: string;
	why?: string;
	fix?: string;
}

interface SubmittedCheckIssue {
	severity: ReviewSeverity;
	file: string;
	line?: number;
	endLine?: number;
	problem: string;
	why?: string;
	fix?: string;
}

export interface CheckRunParams {
	checkName: string;
	checkURI: string;
	diffDescription: string;
	files?: string[];
	instructions: string;
}

export type CheckStatus = { state: "ran"; count: number } | { state: "error" } | { state: "not-run" };

export interface CheckCatalogEntry {
	readonly uri: string;
	readonly definition: CheckDefinition;
	readonly status: CheckStatus;
	readonly comments: readonly ReviewComment[];
}

interface MutableCheckCatalogEntry {
	uri: string;
	definition: CheckDefinition;
	status: CheckStatus;
	comments: ReviewComment[];
}

interface CheckCoordinatorOptions {
	runner: Pick<SubagentRunner, "run">;
	profiles: ResolvedProfiles;
	cwd: string;
	signal?: AbortSignal;
	parentSession?: string;
}

const submittedCheckIssueProperties = {
	severity: Type.Union(reviewSeverities.map((severity) => Type.Literal(severity))),
	file: Type.String(),
	problem: Type.String(),
	why: Type.Optional(Type.String()),
	fix: Type.Optional(Type.String()),
};

const submittedCheckIssueSchema = Type.Union([
	Type.Object(submittedCheckIssueProperties, { additionalProperties: false }),
	Type.Object(
		{ ...submittedCheckIssueProperties, line: Type.Integer({ minimum: 1 }) },
		{ additionalProperties: false },
	),
	Type.Object(
		{
			...submittedCheckIssueProperties,
			line: Type.Integer({ minimum: 1 }),
			endLine: Type.Integer({ minimum: 1 }),
		},
		{ additionalProperties: false },
	),
]);

const checkSystemPrompt = `You run one Code Review Check against an explicitly described diff.
Inspect only; never modify files. Follow the supplied Check instructions and report only issues caused by the diff.
Finish by calling submit_check exactly once. Do not write a final assistant message.`;

function checkURI(check: CheckDefinition): string {
	return pathToFileURL(check.path).href;
}

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

function parseLocation(issue: SubmittedCheckIssue): ReviewLocation | undefined {
	if (issue.line === undefined) {
		if (issue.endLine !== undefined) throw new Error("submit_check issue endLine requires line");
		return undefined;
	}
	if (!Number.isInteger(issue.line) || issue.line < 1)
		throw new Error("submit_check issue line must be a positive integer");
	if (issue.endLine === undefined) return { startLine: issue.line, endLine: issue.line };
	if (!Number.isInteger(issue.endLine) || issue.endLine < 1)
		throw new Error("submit_check issue endLine must be a positive integer");
	if (issue.endLine < issue.line) throw new Error("submit_check issue endLine must not be before line");
	return { startLine: issue.line, endLine: issue.endLine };
}

function normalizeIssues(issues: readonly SubmittedCheckIssue[], source: string): ReviewComment[] {
	return issues.map((issue) => {
		const location = parseLocation(issue);
		return {
			filename: issue.file,
			...(location ? { location } : {}),
			severity: issue.severity,
			text: issue.problem,
			source,
			why: issue.why,
			fix: issue.fix,
		};
	});
}

/** Coordinates URI-identified Check discovery state, execution, and normalized findings. */
export class CheckCoordinator {
	private readonly catalog = new Map<string, MutableCheckCatalogEntry>();
	private readonly options: CheckCoordinatorOptions;

	constructor(checks: readonly CheckDefinition[], options: CheckCoordinatorOptions) {
		this.options = options;
		for (const definition of checks) this.add(definition);
	}

	entries(): readonly CheckCatalogEntry[] {
		return [...this.catalog.values()];
	}

	comments(): ReviewComment[] {
		return [...this.catalog.values()].flatMap((entry) => entry.comments);
	}

	async run(params: CheckRunParams): Promise<string> {
		const entry = await this.resolve(params.checkURI);
		if (params.checkName !== entry.definition.name)
			throw new Error(
				`Check name ${JSON.stringify(params.checkName)} does not match ${JSON.stringify(entry.definition.name)} for ${entry.uri}`,
			);

		entry.comments = [];
		let submitted: ReviewComment[] | undefined;
		let lastError: unknown;
		for (let attempt = 0; attempt < 2; attempt++) {
			submitted = undefined;
			const submitCheck: ToolDefinition<any, any, any> = {
				name: "submit_check",
				label: "submit_check",
				description: "Submit all Check issues and terminate.",
				parameters: Type.Object({ issues: Type.Array(submittedCheckIssueSchema) }),
				async execute(_id, value: { issues: SubmittedCheckIssue[] }) {
					submitted = normalizeIssues(value.issues, entry.definition.name);
					return {
						content: [{ type: "text", text: "Check submitted." }],
						details: {},
						terminate: true,
					} as any;
				},
			};

			try {
				const route = this.options.profiles.agents.review.check;
				await this.options.runner.run({
					definition: {
						key: "review",
						systemPrompt: checkSystemPrompt,
						tools: ["read", "grep", "find", "ls", ...SHELL_TOOLBOX_NAMES, "submit_check"],
						allowMcp: false,
						model: route.model,
						reasoningEffort: route.reasoning,
					},
					cwd: this.options.cwd,
					message: checkMessage(params, entry.definition),
					finalMessage: "optional",
					signal: this.options.signal,
					...(this.options.parentSession
						? {
								record: {
									parentSession: this.options.parentSession,
									name: `check: ${entry.definition.name}`.slice(0, 120),
								},
							}
						: {}),
					toolbox: (processes) => [...createShellToolbox(processes), submitCheck],
				});
				if (!submitted) throw new Error("check child did not submit a check");
				lastError = undefined;
				break;
			} catch (error) {
				if (isSubagentAbortError(error)) throw error;
				lastError = error;
			}
		}

		if (lastError || !submitted) {
			entry.status = { state: "error" };
			return `${entry.definition.name} error.`;
		}
		entry.comments = submitted;
		entry.status = { state: "ran", count: submitted.length };
		return `${entry.definition.name} ran with ${submitted.length} ${submitted.length === 1 ? "issue" : "issues"}.`;
	}

	private add(definition: CheckDefinition): MutableCheckCatalogEntry {
		const uri = checkURI(definition);
		const existing = this.catalog.get(uri);
		if (existing) return existing;
		const entry: MutableCheckCatalogEntry = {
			uri,
			definition,
			status: { state: "not-run" },
			comments: [],
		};
		this.catalog.set(uri, entry);
		return entry;
	}

	private async resolve(uriValue: string): Promise<MutableCheckCatalogEntry> {
		const direct = this.catalog.get(uriValue);
		if (direct) return direct;

		let path: string;
		try {
			const uri = new URL(uriValue);
			if (uri.protocol !== "file:") throw new Error("not file");
			path = fileURLToPath(uri);
		} catch {
			const valid = [...this.catalog.values()].map((entry) => `${entry.definition.name}: ${entry.uri}`).join(", ");
			throw new Error(`Unknown Check URI ${JSON.stringify(uriValue)}. Valid Checks: ${valid || "none"}`);
		}

		const canonicalURI = pathToFileURL(path).href;
		const canonical = this.catalog.get(canonicalURI);
		if (canonical) return canonical;
		let definition: CheckDefinition | undefined;
		try {
			definition = await loadCheck(path);
		} catch (error) {
			throw new Error(`Could not load Check ${uriValue}: ${error instanceof Error ? error.message : String(error)}`);
		}
		if (!definition) throw new Error(`Check ${uriValue} has no instructions`);
		return this.add(definition);
	}
}
