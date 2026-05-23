import type { DiffPayload, ReviewDecision } from "./types";

export function isDiffPayload(value: unknown): value is DiffPayload {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.cwd === "string" && typeof record.patch === "string";
}

const REVIEW_DECISIONS = ["comment", "approve", "request-changes"] as const satisfies readonly ReviewDecision[];

export function isReviewDecision(value: unknown): value is ReviewDecision {
  return typeof value === "string" && REVIEW_DECISIONS.includes(value as ReviewDecision);
}

export function isHTMLElement(value: unknown): value is HTMLElement {
  return value instanceof HTMLElement;
}

export function inputValue(event: Event): string {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
    return "";
  }
  return target.value;
}
