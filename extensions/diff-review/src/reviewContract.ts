import { isReviewDecision } from "./guards";
import type { ReviewAnnotation, ReviewDecision, ReviewPayload, SubmitBody } from "./types";

export function canSubmitReview(payload: Pick<ReviewPayload, "decision" | "annotations" | "summary">): boolean {
  if (payload.decision === "approve") return true;
  return payload.annotations.length > 0 || payload.summary.trim().length > 0;
}

export function normalizeDecision(decision: ReviewDecision | undefined): ReviewDecision {
  return decision ?? "comment";
}

export function parseSubmitBody(value: unknown): SubmitBody {
  if (typeof value !== "object" || value === null) return {};
  const record = value as Record<string, unknown>;
  return {
    decision: isReviewDecision(record.decision) ? record.decision : undefined,
    summary: typeof record.summary === "string" ? record.summary : undefined,
    annotations: Array.isArray(record.annotations) ? sanitizeComments(record.annotations) : undefined,
  };
}

export function sanitizeComments(raw: unknown[]): ReviewAnnotation[] {
  return raw.flatMap((item): ReviewAnnotation[] => {
    if (typeof item !== "object" || item === null) return [];
    const annotation = item as Record<string, unknown>;
    if (typeof annotation.body !== "string" || !annotation.body.trim()) return [];
    return [{
      id: String(annotation.id),
      file: String(annotation.file),
      previousFile: typeof annotation.previousFile === "string" ? annotation.previousFile : undefined,
      side: annotation.side === "deletions" ? "deletions" : "additions",
      startLine: Number(annotation.startLine),
      endLine: Number(annotation.endLine),
      body: annotation.body.trim().slice(0, 8000),
    }];
  });
}

export function buildReviewPrompt(payload: ReviewPayload): string {
  const { cwd, decision, summary, annotations } = payload;
  const decisionLabel = decision === "approve" ? "Approve" : decision === "request-changes" ? "Request changes" : "Comment";
  const summaryBlock = summary ? `\n\nReview summary:\n${summary}` : "";

  if (annotations.length === 0) {
    if (decision === "approve") {
      return `Diff review result for ${cwd}: Approved.${summaryBlock}\n\nThe reviewer found the current working tree diff acceptable. Do not change files unless you see a critical issue; briefly acknowledge.`;
    }
    if (decision === "request-changes") {
      return `Diff review result for ${cwd}: Changes requested.${summaryBlock}\n\nEvaluate the requested changes and apply them when correct. Explain any disagreements. Use normal repo validation after edits.`;
    }
    return `Diff review result for ${cwd}: Comment.${summaryBlock || "\n\nNo inline annotations were provided."} Briefly acknowledge.`;
  }

  const rendered = annotations.map((annotation) => {
    const side = annotation.side === "additions" ? "new" : "old";
    const lines = annotation.startLine === annotation.endLine ? `${side}:${annotation.startLine}` : `${side}:${annotation.startLine}-${annotation.endLine}`;
    return `## ${annotation.file} (${lines})\n${annotation.body}`;
  }).join("\n\n");

  return `Diff review submitted for ${cwd}. Decision: ${decisionLabel}.${summaryBlock}\n\nEvaluate each annotation, apply it when correct, and explain any disagreements. Use normal repo validation after edits.\n\n${rendered}`;
}
