export type AnnotationSide = "additions" | "deletions";
export type ReviewDecision = "comment" | "approve" | "request-changes";

export type ReviewAnnotation = {
  id: string;
  file: string;
  previousFile?: string;
  side: AnnotationSide;
  startLine: number;
  endLine: number;
  body: string;
};

export type DiffPayload = {
  cwd: string;
  patch: string;
};

export type ReviewSubmission = {
  decision: ReviewDecision;
  summary: string;
  annotations: ReviewAnnotation[];
};
