import { describe, expect, it } from "vitest";
import { buildReviewPrompt, canSubmitReview, normalizeDecision, parseSubmitBody, sanitizeComments } from "./reviewContract";

describe("review contract", () => {
  it("allows empty approve but not empty comment", () => {
    expect(canSubmitReview({ decision: "approve", summary: "", annotations: [] })).toBe(true);
    expect(canSubmitReview({ decision: "comment", summary: "", annotations: [] })).toBe(false);
    expect(canSubmitReview({ decision: "request-changes", summary: "", annotations: [] })).toBe(false);
    expect(canSubmitReview({ decision: "comment", summary: "note", annotations: [] })).toBe(true);
  });

  it("builds pi prompt from review payload", () => {
    const prompt = buildReviewPrompt({
      cwd: "/repo",
      decision: "approve",
      summary: "",
      annotations: [],
    });
    expect(prompt).toContain("Approved");
    expect(prompt).toContain("/repo");
  });

  it("parses and sanitizes submit body", () => {
    const body = parseSubmitBody({
      decision: "approve",
      summary: "  ok  ",
      annotations: [{ id: "1", file: "a.ts", side: "additions", startLine: 1, endLine: 1, body: "nit" }],
    });
    expect(normalizeDecision(body.decision)).toBe("approve");
    expect(sanitizeComments(body.annotations ?? [])).toHaveLength(1);
  });
});
