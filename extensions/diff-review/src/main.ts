import { FileDiff, parsePatchFiles, type DiffLineAnnotation, type FileDiffMetadata, type Hunk, type SelectedLineRange } from "@pierre/diffs";
import { getOrCreateWorkerPoolSingleton, terminateWorkerPoolSingleton } from "@pierre/diffs/worker";
import { FileTree } from "@pierre/trees";
import type { AnnotationSide, DiffPayload, ReviewAnnotation, ReviewDecision } from "./types";
import "./styles.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AnnotationMetadata = {
  kind: "comment" | "draft";
  id: string;
  body: string;
  startLine: number;
  endLine: number;
};

type DiffStyle = "unified" | "split";

type FileStats = { additions: number; deletions: number };

type State = {
  payload: DiffPayload | null;
  files: FileDiffMetadata[];
  fileStatsByName: Map<string, FileStats>;
  annotations: ReviewAnnotation[];
  draft: { file: FileDiffMetadata; range: SelectedLineRange } | null;
  draftBody: string;
  diffStyle: DiffStyle;
  activeFileIndex: number;
  reviewOpen: boolean;
  submitting: boolean;
  submitted: boolean;
  summary: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const workerFactory = () => new Worker(new URL("@pierre/diffs/worker/worker.js", import.meta.url), { type: "module" });
const highlighterOptions = { lineDiffType: "word" as const, theme: "catppuccin-macchiato" as const, tokenizeMaxLineLength: 2000 };
const workerPool = getOrCreateWorkerPoolSingleton({
  highlighterOptions,
  poolOptions: { poolSize: Math.min(4, navigator.hardwareConcurrency || 2), workerFactory },
});
const params = new URLSearchParams(window.location.search);
const token = params.get("token") ?? "";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state: State = {
  payload: null,
  files: [],
  fileStatsByName: new Map(),
  annotations: [],
  draft: null,
  draftBody: "",
  diffStyle: "unified",
  activeFileIndex: 0,
  reviewOpen: false,
  submitting: false,
  submitted: false,
  summary: "",
};

// ---------------------------------------------------------------------------
// Instance tracking
// ---------------------------------------------------------------------------

const fileDiffInstances = new Map<string, FileDiff<AnnotationMetadata>>();
const fileSections = new Map<string, HTMLElement>();
let fileTree: FileTree | null = null;
let lazyObserver: IntersectionObserver | null = null;

// Stable shell DOM refs (set once in bootstrap)
let shellToolbar: HTMLElement;
let shellSidebar: HTMLElement;
let shellCommentsPanel: HTMLElement;
let shellFilesContent: HTMLElement;
let shellFilesContainer: HTMLElement;
let shellModalLayer: HTMLElement;
let diffStyleButton: HTMLButtonElement;
let reviewButton: HTMLButtonElement;
let switchSidebarView: ((view: "files" | "comments") => void) | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: Array<Node | string | null | undefined>): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "className") node.className = String(value);
    else if (key === "textContent") node.textContent = String(value);
    else if (key === "html") node.innerHTML = String(value);
    else if (key === "value" && "value" in node) (node as HTMLInputElement).value = String(value);
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    else if (typeof value === "boolean") node.setAttribute(key, String(value));
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child) node.append(child);
  }
  return node;
}

function icon(path: string): HTMLElement {
  return el("span", { html: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none">${path}</svg>` });
}

// ---------------------------------------------------------------------------
// Pure helpers (no DOM, no state mutation)
// ---------------------------------------------------------------------------

function normalizeRange(range: SelectedLineRange): { side: AnnotationSide; start: number; end: number } | null {
  if (!range.side) return null;
  // Cross-side selection: anchor to the side the user started from
  const side = range.side;
  if (range.endSide && range.endSide !== side) {
    return { side, start: range.start, end: range.start };
  }
  return { side, start: Math.min(range.start, range.end), end: Math.max(range.start, range.end) };
}

function hunkContainsRange(hunk: Hunk, side: AnnotationSide, start: number, end: number): boolean {
  if (side === "additions") return start >= hunk.additionStart && end < hunk.additionStart + hunk.additionCount;
  return start >= hunk.deletionStart && end < hunk.deletionStart + hunk.deletionCount;
}

function findHunkIndex(file: FileDiffMetadata, side: AnnotationSide, start: number, end: number): number {
  return file.hunks.findIndex((hunk) => hunkContainsRange(hunk, side, start, end));
}

function isBinaryPlaceholder(file: FileDiffMetadata): boolean {
  return file.hunks.length === 0 && file.additionLines.length === 0 && file.deletionLines.length === 0;
}

function computeFileStats(file: FileDiffMetadata): FileStats {
  return file.hunks.reduce<FileStats>((s, h) => ({ additions: s.additions + h.additionLines, deletions: s.deletions + h.deletionLines }), { additions: 0, deletions: 0 });
}

function compareTreePaths(left: string, right: string): number {
  const l = left.toLowerCase().split("/");
  const r = right.toLowerCase().split("/");
  const depth = Math.min(l.length, r.length);
  for (let i = 0; i < depth; i++) {
    if (l[i] === r[i]) continue;
    const lDir = i < l.length - 1;
    const rDir = i < r.length - 1;
    if (lDir !== rDir) return lDir ? -1 : 1;
    return l[i].localeCompare(r[i], undefined, { numeric: true });
  }
  return l.length - r.length || left.localeCompare(right, undefined, { numeric: true });
}

function annotationsForFile(file: FileDiffMetadata): DiffLineAnnotation<AnnotationMetadata>[] {
  const out: DiffLineAnnotation<AnnotationMetadata>[] = state.annotations
    .filter((a) => a.file === file.name)
    .map((a) => ({
      side: a.side,
      lineNumber: a.endLine,
      metadata: { kind: "comment" as const, id: a.id, body: a.body, startLine: a.startLine, endLine: a.endLine },
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

// ---------------------------------------------------------------------------
// Render callbacks (passed to FileDiff — stable references)
// ---------------------------------------------------------------------------

function renderAnnotation(annotation: DiffLineAnnotation<AnnotationMetadata>): HTMLElement | undefined {
  const m = annotation.metadata;
  if (!m) return undefined;
  const label = m.startLine === m.endLine ? `Line ${m.startLine}` : `Lines ${m.startLine}-${m.endLine}`;

  if (m.kind === "draft") {
    const submitBtn = el("button", { className: "primary", type: "submit" }, "Comment");
    const textarea = el("textarea", {
      "aria-label": "Annotation body",
      placeholder: "Add a note…",
      oninput: (e: Event) => { state.draftBody = (e.target as HTMLTextAreaElement).value; },
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === "Enter" && e.metaKey && state.draftBody.trim()) { e.preventDefault(); commitDraft(); }
        if (e.key === "Escape") { e.preventDefault(); closeDraft(); }
      },
    }) as HTMLTextAreaElement;
    textarea.value = state.draftBody;
    queueMicrotask(() => textarea.focus());
    return el("form", { className: "annotation annotationDraft", onsubmit: (e: Event) => { e.preventDefault(); commitDraft(); } },
      el("strong", { textContent: label }),
      textarea,
      el("div", { className: "annotationActions" },
        el("button", { type: "button", onclick: closeDraft }, "Discard"),
        submitBtn,
      ),
    );
  }

  return el("div", { className: "annotation" },
    el("strong", { textContent: label }),
    el("p", { textContent: m.body }),
  );
}

// ---------------------------------------------------------------------------
// Targeted DOM updaters
// ---------------------------------------------------------------------------

function updateAnnotationsForFile(fileName: string): void {
  const file = state.files.find((f) => f.name === fileName);
  if (!file) return;
  const instance = fileDiffInstances.get(fileName);
  if (!instance) return;
  instance.setLineAnnotations(annotationsForFile(file));
  instance.rerender();
}

function paintCommentsPanel(): void {
  shellCommentsPanel.replaceChildren(
    ...(state.annotations.length === 0
      ? [el("p", { textContent: "No comments" })]
      : state.annotations.map((a) =>
          el("button", { type: "button", onclick: () => scrollToPath(a.file) },
            el("strong", { textContent: a.file }),
            el("span", { textContent: `Line ${a.startLine}: ${a.body}` }),
          ),
        )),
  );
}

function openDraft(file: FileDiffMetadata, index: number, range: SelectedLineRange, showAlerts = false): void {
  const n = normalizeRange(range);
  if (!n) { if (showAlerts) alert("Could not determine selection side."); return; }
  if (findHunkIndex(file, n.side, n.start, n.end) < 0) { if (showAlerts) alert("Selection must be within a single hunk."); return; }

  // close previous draft's inline annotation if on different file
  const prevFile = state.draft?.file.name;
  state.activeFileIndex = index;
  state.draft = { file, range };
  state.draftBody = "";

  if (prevFile && prevFile !== file.name) updateAnnotationsForFile(prevFile);
  updateAnnotationsForFile(file.name);
}

function closeDraft(): void {
  const prevFile = state.draft?.file.name;
  state.draft = null;
  state.draftBody = "";
  if (prevFile) updateAnnotationsForFile(prevFile);
}

function commitDraft(): void {
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
  updateAnnotationsForFile(fileName);
  paintCommentsPanel();
}

function toggleDiffStyle(): void {
  state.diffStyle = state.diffStyle === "split" ? "unified" : "split";
  updateDiffStyleButton();
  rebuildAllFileDiffs();
}

function updateDiffStyleButton(): void {
  const isSplit = state.diffStyle === "split";
  diffStyleButton.setAttribute("aria-label", isSplit ? "Switch to unified view" : "Switch to split view");
  diffStyleButton.replaceChildren(
    isSplit
      ? icon('<path d="M3 4h10M3 8h10M3 12h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>')
      : icon('<path d="M3 3.5h4v9H3zM9 3.5h4v9H9z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M4.5 6h1M10.5 6h1M4.5 8h1M10.5 8h1M4.5 10h1M10.5 10h1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'),
  );
}

function showReviewModal(): void {
  state.reviewOpen = true;
  shellModalLayer.replaceChildren();
  const textarea = el("textarea", {
    autofocus: true,
    "aria-label": "Review summary",
    placeholder: "Overall feedback…",
    oninput: (e: Event) => { state.summary = (e.target as HTMLTextAreaElement).value; },
    onkeydown: (e: KeyboardEvent) => { if (e.key === "Enter" && e.metaKey) { e.preventDefault(); submitReview("comment"); } },
  }) as HTMLTextAreaElement;
  textarea.value = state.summary;
  shellModalLayer.append(
    el("div", { className: "modalBackdrop", onclick: hideReviewModal },
      el("div", { className: "reviewModal", onclick: (e: Event) => e.stopPropagation() },
        el("header", {},
          el("h2", { textContent: "Submit review" }),
          el("p", { textContent: `${state.annotations.length} comment${state.annotations.length === 1 ? "" : "s"}` }),
        ),
        textarea,
        el("div", { className: "modalActions" },
          el("button", { className: "danger", type: "button", disabled: state.submitting || state.submitted, onclick: () => submitReview("request-changes") }, "Request changes"),
          el("button", { className: "approve", type: "button", disabled: state.submitting || state.submitted, onclick: () => submitReview("approve") }, "Approve"),
          el("button", { className: "primary", type: "button", disabled: state.submitting || state.submitted, onclick: () => submitReview("comment") }, "Submit"),
        ),
      ),
    ),
  );
  shellModalLayer.style.display = "";
  textarea.focus();
}

function hideReviewModal(): void {
  state.reviewOpen = false;
  shellModalLayer.replaceChildren();
  shellModalLayer.style.display = "none";
}

function submitReview(decision: ReviewDecision): void {
  state.submitting = true;
  reviewButton.toggleAttribute("disabled", true);
  fetch(`/api/submit?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-pi-diff-review-token": token },
    body: JSON.stringify({ decision, summary: state.summary, annotations: state.annotations }),
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(await res.text());
      state.submitted = true;
      window.close();
    })
    .catch((err) => alert(err instanceof Error ? err.message : String(err)))
    .finally(() => {
      state.submitting = false;
      reviewButton.toggleAttribute("disabled", state.submitted);
      if (state.reviewOpen) showReviewModal(); // refresh button states
    });
}

// ---------------------------------------------------------------------------
// File navigation
// ---------------------------------------------------------------------------

function scrollToFile(index: number): void {
  const file = state.files[index];
  if (!file) return;
  state.activeFileIndex = index;
  fileSections.get(file.name)?.scrollIntoView({ block: "start" });
  fileTree?.focusPath(file.name);
}

function scrollToPath(path: string): void {
  const i = state.files.findIndex((f) => f.name === path);
  if (i >= 0) scrollToFile(i);
}

// ---------------------------------------------------------------------------
// FileDiff lifecycle
// ---------------------------------------------------------------------------

function instantiateFileDiff(file: FileDiffMetadata, index: number, section: HTMLElement): void {
  if (fileDiffInstances.has(file.name)) return;
  const instance = new FileDiff<AnnotationMetadata>({
    diffStyle: state.diffStyle,
    ...highlighterOptions,
    themeType: "dark",
    hunkSeparators: "simple",
    enableGutterUtility: true,
    enableLineSelection: true,
    lineHoverHighlight: "both",
    overflow: "wrap",
    unsafeCSS: "[data-diffs-header] { position: sticky; top: 0; z-index: 3; background: oklch(0.3538 0.0369 275.99); border-top: 1px solid oklch(0.4259 0.0385 276.95); border-bottom: 1px solid oklch(0.4259 0.0385 276.95); }",
    onGutterUtilityClick: (range) => openDraft(file, index, range),
    onLineSelected: (range) => { if (range) openDraft(file, index, range, true); },
    renderAnnotation,
  }, workerPool);
  fileDiffInstances.set(file.name, instance);
  instance.render({ fileDiff: file, lineAnnotations: annotationsForFile(file), containerWrapper: section });
}

function buildFileSections(): void {
  shellFilesContent.replaceChildren();
  fileSections.clear();
  lazyObserver?.disconnect();
  lazyObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const section = entry.target as HTMLElement;
        const fileName = section.dataset.fileName;
        if (!fileName) continue;
        const index = state.files.findIndex((f) => f.name === fileName);
        if (index < 0) continue;
        instantiateFileDiff(state.files[index], index, section);
        lazyObserver?.unobserve(section);
      }
    },
    { root: shellFilesContainer, rootMargin: "200px" },
  );

  for (const [index, file] of state.files.entries()) {
    const section = el("section", { className: "filePanel", "data-file-name": file.name });
    // Match FileDiff header height so observer triggers for off-screen files
    section.style.minHeight = "39px";
    fileSections.set(file.name, section);
    shellFilesContent.append(section);
    lazyObserver.observe(section);
  }
}

function rebuildAllFileDiffs(): void {
  fileDiffInstances.forEach((inst) => inst.cleanUp());
  fileDiffInstances.clear();
  buildFileSections();
}

// ---------------------------------------------------------------------------
// File tree (sidebar)
// ---------------------------------------------------------------------------

function buildFileTree(): void {
  shellSidebar.replaceChildren();
  if (state.files.length === 0) {
    shellSidebar.append(el("p", { textContent: "No changed files" }));
    return;
  }

  const treeHost = el("div", { className: "treeHost" });
  shellCommentsPanel = el("div", { className: "commentsPanel", style: "display:none" });
  let view: "files" | "comments" = "files";

  switchSidebarView = (next: "files" | "comments") => {
    view = next;
    treeHost.style.display = view === "files" ? "block" : "none";
    shellCommentsPanel.style.display = view === "comments" ? "block" : "none";
    filesBtn.classList.toggle("active", view === "files");
    commentsBtn.classList.toggle("active", view === "comments");
    if (view === "comments") paintCommentsPanel();
  };

  const filesBtn = el("button", { className: "active", type: "button", "aria-label": "Files", onclick: () => switchSidebarView?.("files") },
    icon('<path d="M2.5 4.5h4l1 1h6v6h-11zM2.5 3h4l1 1h6" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>'));
  const commentsBtn = el("button", { type: "button", "aria-label": "Comments", onclick: () => switchSidebarView?.("comments") },
    icon('<path d="M3 4.5A2.5 2.5 0 015.5 2h5A2.5 2.5 0 0113 4.5v3A2.5 2.5 0 0110.5 10H7l-3.5 3v-3.5A2.5 2.5 0 013 7.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>'));
  const searchBtn = el("button", { className: "searchIcon", type: "button", "aria-label": "Show file search", onclick: () => { switchSidebarView?.("files"); fileTree?.openSearch(); } },
    icon('<path d="M7 12a5 5 0 100-10 5 5 0 000 10zM10.8 10.8L14 14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'));

  const tabs = el("div", { className: "sidebarTabs" }, filesBtn, commentsBtn, searchBtn);

  fileTree?.cleanUp();
  fileTree = new FileTree({
    paths: state.files.map((f) => f.name),
    density: "compact",
    fileTreeSearchMode: "hide-non-matches",
    flattenEmptyDirectories: true,
    gitStatus: state.files.map((f) => ({
      path: f.name,
      status: f.type === "new" ? "added" : f.type === "deleted" ? "deleted" : f.type === "rename-changed" || f.type === "rename-pure" ? "renamed" : "modified",
    })),
    icons: { set: "minimal", colored: true },
    initialExpansion: "open",
    initialSelectedPaths: state.files[state.activeFileIndex]?.name ? [state.files[state.activeFileIndex].name] : [],
    initialVisibleRowCount: 80,
    onSelectionChange: (paths) => { const p = paths.at(-1); if (p) scrollToPath(p); },
    overscan: 18,
    search: true,
    unsafeCSS: `[data-file-tree-search-container][data-open='false'] { display: none; } [data-file-tree-search-container] { padding-bottom: 12px; margin-bottom: 12px; border-bottom: 1px solid var(--trees-border-color-override, var(--color-border)); }`,
  });
  fileTree.render({ containerWrapper: treeHost });

  // Stats
  const totals: FileStats = { additions: 0, deletions: 0 };
  for (const s of state.fileStatsByName.values()) { totals.additions += s.additions; totals.deletions += s.deletions; }

  const stats = el("div", { className: "sidebarStats" },
    el("dl", {},
      el("div", {}, el("dt", { textContent: "Files" }), el("dd", { textContent: state.files.length })),
      el("div", {}, el("dt", { textContent: "Additions" }), el("dd", { className: "additions", textContent: totals.additions.toLocaleString() })),
      el("div", {}, el("dt", { textContent: "Deletions" }), el("dd", { className: "deletions", textContent: totals.deletions.toLocaleString() })),
      el("div", {}, el("dt", { textContent: "Lines" }), el("dd", { textContent: (totals.additions + totals.deletions).toLocaleString() })),
    ),
  );

  shellSidebar.append(tabs, treeHost, shellCommentsPanel, stats);
}

// ---------------------------------------------------------------------------
// Keyboard navigation
// ---------------------------------------------------------------------------

function handleKeydown(e: KeyboardEvent): void {
  const tag = (e.target as HTMLElement).tagName;
  const inInput = tag === "INPUT" || tag === "TEXTAREA";
  // Always allow Escape and Cmd-combos; block bare keys when typing
  if (inInput && e.key !== "Escape" && !e.metaKey) return;

  switch (e.key) {
    case "j": // next file
    case "ArrowDown":
      e.preventDefault();
      scrollToFile(Math.min(state.activeFileIndex + 1, state.files.length - 1));
      break;
    case "k": // prev file
    case "ArrowUp":
      e.preventDefault();
      scrollToFile(Math.max(state.activeFileIndex - 1, 0));
      break;
    case "u": // unified
      e.preventDefault();
      if (state.diffStyle !== "unified") toggleDiffStyle();
      break;
    case "s": // split
      e.preventDefault();
      if (state.diffStyle !== "split") toggleDiffStyle();
      break;
    case "r": // review
      if (e.metaKey || e.ctrlKey) break; // let browser handle Cmd+R / Ctrl+R
      e.preventDefault();
      if (!state.reviewOpen) showReviewModal();
      break;
    case "Escape":
      e.preventDefault();
      if (state.reviewOpen) hideReviewModal();
      else if (state.draft) closeDraft();
      break;
    case "f": // files sidebar
      e.preventDefault();
      switchSidebarView?.("files");
      break;
    case "c": // comments sidebar
      e.preventDefault();
      switchSidebarView?.("comments");
      break;
    case "/": // file search
      e.preventDefault();
      fileTree?.openSearch();
      break;
    case "?": // help
      e.preventDefault();
      alert("Keyboard shortcuts:\n\nj / ↓  Next file\nk / ↑  Previous file\nf      Files panel\nc      Comments panel\nu      Unified view\ns      Split view\nr      Open review\n/      Search files\nEsc    Close modal / draft\n?      This help");
      break;
  }
}

// ---------------------------------------------------------------------------
// Bootstrap — builds shell once, then fills it
// ---------------------------------------------------------------------------

type DiffStoreState =
  | { status: "pending" }
  | { status: "success"; payload: DiffPayload }
  | { status: "error"; message: string };

function bootstrap(fetchState: DiffStoreState): void {
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing #root");

  if (fetchState.status === "error") {
    root.replaceChildren(el("main", { className: "shell" }, el("p", { className: "error", textContent: fetchState.message })));
    return;
  }
  if (fetchState.status === "pending") {
    root.replaceChildren(el("main", { className: "shell" }, el("p", { textContent: "Loading diff…" })));
    return;
  }

  // Parse payload
  state.payload = fetchState.payload;
  const parsed = parsePatchFiles(state.payload.patch, "pi-diffs", true);
  const visible: FileDiffMetadata[] = [];
  for (const patch of parsed) {
    for (const file of patch.files) if (!isBinaryPlaceholder(file)) visible.push(file);
  }
  state.files = visible.sort((a, b) => compareTreePaths(a.name, b.name));
  state.fileStatsByName = new Map(state.files.map((f) => [f.name, computeFileStats(f)]));

  // Build shell once
  root.replaceChildren();

  const shell = el("main", { className: "shell" }, el("h1", { className: "srOnly", textContent: "Diff Review" }));

  diffStyleButton = el("button", { className: "iconButton", type: "button", onclick: toggleDiffStyle }) as HTMLButtonElement;
  reviewButton = el("button", { className: "reviewButton", onclick: showReviewModal }, "Review") as HTMLButtonElement;

  shellToolbar = el("header", { className: "toolbar" },
    el("input", { className: "repoInput", readonly: true, value: state.payload.cwd, "aria-label": "Repository path" }),
    el("div", { className: "toolbarRight" }, diffStyleButton, reviewButton),
  );
  updateDiffStyleButton();

  shellSidebar = el("aside", { className: "fileSidebar", "aria-label": "Changed files" });
  shellFilesContent = el("div", { className: "filesContent" });
  shellFilesContainer = el("div", { className: "files" }, shellFilesContent);
  shellModalLayer = el("div", { className: "modalLayer" });
  shellModalLayer.style.display = "none";

  const layout = el("div", { className: "reviewLayout" }, shellSidebar, shellFilesContainer);
  shell.append(shellToolbar, layout);
  root.append(shell, shellModalLayer);

  // Fill content
  buildFileTree();
  buildFileSections();

  // Keyboard
  document.addEventListener("keydown", handleKeydown);
}

// ---------------------------------------------------------------------------
// Fetch + init
// ---------------------------------------------------------------------------

function createDiffStore(): { getSnapshot: () => DiffStoreState; subscribe: (listener: () => void) => () => void } {
  let fetchState: DiffStoreState = { status: "pending" };
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());

  fetch(`/api/diff?token=${encodeURIComponent(token)}`)
    .then(async (res) => { if (!res.ok) throw new Error(await res.text()); return res.json() as Promise<DiffPayload>; })
    .then((p) => { fetchState = { status: "success", payload: p }; notify(); })
    .catch((e) => { fetchState = { status: "error", message: e instanceof Error ? e.message : String(e) }; notify(); });

  return {
    getSnapshot: () => fetchState,
    subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
  };
}

const diffStore = createDiffStore();
diffStore.subscribe(() => bootstrap(diffStore.getSnapshot()));
bootstrap(diffStore.getSnapshot());

window.addEventListener("pagehide", () => {
  fileTree?.cleanUp();
  fileDiffInstances.forEach((inst) => inst.cleanUp());
  lazyObserver?.disconnect();
  terminateWorkerPoolSingleton();
});
