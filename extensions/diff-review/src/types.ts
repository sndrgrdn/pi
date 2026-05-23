import type { FileDiff } from "@pierre/diffs";
import type { FileDiffMetadata, SelectedLineRange } from "@pierre/diffs";
import type { FileTree } from "@pierre/trees";

// Domain — shared with extension server (index.ts) and browser UI

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

export type SubmitBody = {
  decision?: ReviewDecision;
  summary?: string;
  annotations?: ReviewAnnotation[];
};

export type ReviewPayload = {
  cwd: string;
  decision: ReviewDecision;
  summary: string;
  annotations: ReviewAnnotation[];
};

// UI — Pierre diff rendering + review shell

export type CommentMetadata = {
  kind: "comment";
  id: string;
  body: string;
  startLine: number;
  endLine: number;
};

export type DraftMetadata = {
  kind: "draft";
  id: "draft";
  body: string;
  startLine: number;
  endLine: number;
};

export type AnnotationMetadata = CommentMetadata | DraftMetadata;

export type DiffStyle = "unified" | "split";
export type FileStats = { additions: number; deletions: number };

export type State = {
  files: FileDiffMetadata[];
  annotations: ReviewAnnotation[];
  draft: { file: FileDiffMetadata; range: SelectedLineRange } | null;
  draftBody: string;
  diffStyle: DiffStyle;
  activeFileIndex: number;
  reviewOpen: boolean;
  submitting: boolean;
  submitted: boolean;
  summary: string;
  collapsedFiles: Set<string>;
};

export type ShellRefs = {
  sidebar: HTMLElement;
  treeHost: HTMLElement;
  filesContent: HTMLElement;
  filesContainer: HTMLElement;
  modalLayer: HTMLElement;
  diffStyleButton: HTMLButtonElement;
  collapseButton: HTMLButtonElement;
  reviewButton: HTMLButtonElement;
};

export type SidebarStats = {
  files: HTMLElement;
  additions: HTMLElement;
  deletions: HTMLElement;
  lines: HTMLElement;
};

export type App = {
  token: string;
  state: State;
  ui: ShellRefs | null;
  fileDiffInstances: Map<string, FileDiff<AnnotationMetadata>>;
  fileSections: Map<string, HTMLElement>;
  live: {
    fileTree: FileTree | null;
    lazyObserver: IntersectionObserver | null;
    sidebarStats: SidebarStats | null;
  };
};
