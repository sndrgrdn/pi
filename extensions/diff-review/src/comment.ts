import type { DiffLineAnnotation, FileDiffMetadata, SelectedLineRange } from "@pierre/diffs";
import type { App } from "./types";
import { el } from "./dom";
import { inputValue } from "./guards";
import { normalizeRange, findHunkIndex } from "./diffUtils";
import type { AnnotationMetadata } from "./types";

export function commentsForFile(app: App, file: FileDiffMetadata): DiffLineAnnotation<AnnotationMetadata>[] {
  const { state } = app;
  const out: DiffLineAnnotation<AnnotationMetadata>[] = state.annotations
    .filter((a) => a.file === file.name)
    .map((a) => ({
      side: a.side,
      lineNumber: a.endLine,
      metadata: { kind: "comment", id: a.id, body: a.body, startLine: a.startLine, endLine: a.endLine },
    }));

  if (state.draft?.file.name === file.name) {
    const n = normalizeRange(state.draft.range);
    if (n) {
      out.push({
        side: n.side,
        lineNumber: n.end,
        metadata: { kind: "draft", id: "draft", body: state.draftBody, startLine: n.start, endLine: n.end },
      });
    }
  }
  return out;
}

export function renderComment(app: App, annotation: DiffLineAnnotation<AnnotationMetadata>): HTMLElement | undefined {
  const { state } = app;
  const m = annotation.metadata;
  if (!m) return undefined;
  const label = m.startLine === m.endLine ? `Line ${m.startLine}` : `Lines ${m.startLine}-${m.endLine}`;

  if (m.kind === "draft") {
    const submitBtn = el("button", { className: "primary", type: "submit" }, "Comment");
    const textarea = el("textarea", {
      "aria-label": "Annotation body",
      placeholder: "Add a note…",
      oninput: (e: Event) => { state.draftBody = inputValue(e); },
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === "Enter" && e.metaKey && state.draftBody.trim()) { e.preventDefault(); commitComment(app); }
        if (e.key === "Escape") { e.preventDefault(); discardComment(app); }
      },
    });
    textarea.value = state.draftBody;
    queueMicrotask(() => textarea.focus());
    return el("form", { className: "annotation annotationDraft", onsubmit: (e: Event) => { e.preventDefault(); commitComment(app); } },
      el("strong", { textContent: label }),
      textarea,
      el("div", { className: "annotationActions" },
        el("button", { type: "button", onclick: () => discardComment(app) }, "Discard"),
        submitBtn,
      ),
    );
  }

  return el("div", { className: "annotation" },
    el("strong", { textContent: label }),
    el("p", { textContent: m.body }),
  );
}

function refreshCommentsForFile(app: App, fileName: string): void {
  const { state, fileDiffInstances } = app;
  const file = state.files.find((f) => f.name === fileName);
  if (!file) return;
  const instance = fileDiffInstances.get(fileName);
  if (!instance) return;
  instance.setLineAnnotations(commentsForFile(app, file));
  instance.rerender();
}

export function startComment(app: App, file: FileDiffMetadata, range: SelectedLineRange, showAlerts = false): void {
  const { state } = app;
  const index = state.files.findIndex((f) => f.name === file.name);
  if (index < 0) return;
  const n = normalizeRange(range);
  if (!n) { if (showAlerts) alert("Could not determine selection side."); return; }
  if (findHunkIndex(file, n.side, n.start, n.end) < 0) { if (showAlerts) alert("Selection must be within a single hunk."); return; }

  const prevFile = state.draft?.file.name;
  state.activeFileIndex = index;
  state.draft = { file, range };
  state.draftBody = "";

  if (prevFile && prevFile !== file.name) refreshCommentsForFile(app, prevFile);
  refreshCommentsForFile(app, file.name);
}

export function discardComment(app: App): void {
  const prevFile = app.state.draft?.file.name;
  app.state.draft = null;
  app.state.draftBody = "";
  if (prevFile) refreshCommentsForFile(app, prevFile);
}

export function commitComment(app: App): void {
  const { state } = app;
  if (!state.draft) return;
  const n = normalizeRange(state.draft.range);
  if (!n || !state.draftBody.trim()) return;
  state.annotations.push({
    id: crypto.randomUUID(),
    file: state.draft.file.name,
    previousFile: state.draft.file.prevName,
    side: n.side,
    startLine: n.start,
    endLine: n.end,
    body: state.draftBody.trim(),
  });
  const fileName = state.draft.file.name;
  state.draft = null;
  state.draftBody = "";
  refreshCommentsForFile(app, fileName);
}
