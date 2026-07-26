/**
 * Comment — the single home for the Code Review finding: severity vocabulary,
 * location invariants, the canonical shape, and the adapters both terminating
 * submit tools parse at their boundary.
 */
import { Type } from "typebox";

export const reviewSeverities = ["critical", "high", "medium", "low"] as const;
export type ReviewSeverity = (typeof reviewSeverities)[number];

export function parseSeverity(value: string): ReviewSeverity | undefined {
	return (reviewSeverities as readonly string[]).includes(value) ? (value as ReviewSeverity) : undefined;
}

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

const severitySchema = Type.Union(reviewSeverities.map((severity) => Type.Literal(severity)));

/** A line range from submitted endpoints; `undefined` when no line was given. */
export function parseLocation(
	line: number | undefined,
	endLine: number | undefined,
	context: string,
): ReviewLocation | undefined {
	if (line === undefined) {
		if (endLine !== undefined) throw new Error(`${context} endLine requires line`);
		return undefined;
	}
	if (!Number.isInteger(line) || line < 1) throw new Error(`${context} line must be a positive integer`);
	if (endLine === undefined) return { startLine: line, endLine: line };
	if (!Number.isInteger(endLine) || endLine < 1) throw new Error(`${context} endLine must be a positive integer`);
	if (endLine < line) throw new Error(`${context} endLine must not be before line`);
	return { startLine: line, endLine };
}

/** `submit_review` wire shape. */
export interface SubmittedComment {
	filename: string;
	startLine: number;
	endLine: number;
	severity: ReviewSeverity;
	text: string;
	why?: string;
	fix?: string;
}

export const submittedCommentSchema = Type.Object({
	filename: Type.String(),
	startLine: Type.Integer({ minimum: 1 }),
	endLine: Type.Integer({ minimum: 1 }),
	severity: severitySchema,
	text: Type.String(),
	why: Type.Optional(Type.String()),
	fix: Type.Optional(Type.String()),
});

export function commentFromSubmission(comment: SubmittedComment): ReviewComment {
	return {
		filename: comment.filename,
		location: parseLocation(comment.startLine, comment.endLine, "submit_review comment"),
		severity: comment.severity,
		text: comment.text,
		why: comment.why,
		fix: comment.fix,
	};
}

/** `submit_check` wire shape; an omitted severity takes the Check's `severity-default`. */
export interface SubmittedCheckComment {
	severity?: ReviewSeverity;
	file: string;
	line?: number;
	endLine?: number;
	problem: string;
	why?: string;
	fix?: string;
}

const submittedCheckCommentProperties = {
	severity: Type.Optional(severitySchema),
	file: Type.String(),
	problem: Type.String(),
	why: Type.Optional(Type.String()),
	fix: Type.Optional(Type.String()),
};

export const submittedCheckCommentSchema = Type.Union([
	Type.Object(submittedCheckCommentProperties, { additionalProperties: false }),
	Type.Object(
		{ ...submittedCheckCommentProperties, line: Type.Integer({ minimum: 1 }) },
		{ additionalProperties: false },
	),
	Type.Object(
		{
			...submittedCheckCommentProperties,
			line: Type.Integer({ minimum: 1 }),
			endLine: Type.Integer({ minimum: 1 }),
		},
		{ additionalProperties: false },
	),
]);

export function commentFromCheckSubmission(
	submitted: SubmittedCheckComment,
	source: string,
	defaultSeverity: ReviewSeverity,
): ReviewComment {
	const location = parseLocation(submitted.line, submitted.endLine, "submit_check issue");
	return {
		filename: submitted.file,
		...(location ? { location } : {}),
		severity: submitted.severity ?? defaultSeverity,
		text: submitted.problem,
		source,
		why: submitted.why,
		fix: submitted.fix,
	};
}
