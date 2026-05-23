import { FileDiff, type DiffLineAnnotation, type FileDiffMetadata } from "@pierre/diffs";
import type { App, AnnotationMetadata } from "./types";
import { getUi } from "./app";
import { commentsForFile, renderComment, startComment } from "./comment";
import { el, icon } from "./dom";
import { isBinaryPlaceholder } from "./diffUtils";
import { highlighterOptions, workerPool } from "./worker";

const FILE_HEADER_HEIGHT = "39px";
const FILE_DIFF_HEADER_CSS =
  "[data-diffs-header] { position: sticky; top: 0; z-index: 3; background: oklch(0.3538 0.0369 275.99); border-top: 1px solid oklch(0.4259 0.0385 276.95); border-bottom: 1px solid oklch(0.4259 0.0385 276.95); cursor: pointer; }";

function isAllCollapsed(app: App): boolean {
  const { state } = app;
  return state.files.length > 0 && state.collapsedFiles.size === state.files.length;
}

function isFileCollapsed(app: App, fileName: string): boolean {
  return app.state.collapsedFiles.has(fileName);
}

function setAllCollapsed(app: App, collapsed: boolean): void {
  app.state.collapsedFiles = collapsed ? new Set(app.state.files.map((f) => f.name)) : new Set();
}

function makeCollapseChevron(app: App, fileName: string): HTMLElement {
  const collapsed = isFileCollapsed(app, fileName);
  return el("button", {
    className: "collapseChevron",
    type: "button",
    "aria-label": collapsed ? "Expand file" : "Collapse file",
    onclick: (e: Event) => { e.stopPropagation(); toggleFileCollapsed(app, fileName); },
  }, icon(`<path d="${collapsed ? "M6 4l4 4-4 4" : "M4 6l4 4 4-4"}" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`));
}

function attachHeaderToggle(app: App, section: HTMLElement, fileName: string): void {
  section.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest(".collapseChevron")) return;
    const hitHeader = event.composedPath().some(
      (node) => node instanceof Element && node.hasAttribute("data-diffs-header"),
    );
    if (hitHeader) toggleFileCollapsed(app, fileName);
  });
}

function buildBinaryPanel(app: App, file: FileDiffMetadata): HTMLElement {
  const collapsed = isFileCollapsed(app, file.name);
  const section = el("section", {
    className: `filePanel filePanelBinary${collapsed ? " filePanelCollapsed" : ""}`,
    "data-file-name": file.name,
  });
  section.append(
    el("header", { className: "binaryHeader" },
      makeCollapseChevron(app, file.name),
      el("span", { className: "binaryFileName", textContent: file.name }),
      el("span", { className: "binaryLabel", textContent: "Binary file" }),
    ),
  );
  attachHeaderToggle(app, section, file.name);
  return section;
}

function applyFileCollapse(app: App, fileName: string, collapsed: boolean): void {
  const { state, fileDiffInstances, fileSections } = app;
  const file = state.files.find((f) => f.name === fileName);
  if (!file) return;

  if (isBinaryPlaceholder(file)) {
    const section = fileSections.get(fileName);
    section?.classList.toggle("filePanelCollapsed", collapsed);
    section?.querySelector(".collapseChevron")?.replaceWith(makeCollapseChevron(app, fileName));
    return;
  }

  const instance = fileDiffInstances.get(fileName);
  if (instance) {
    instance.setOptions({ ...instance.options, collapsed });
    instance.rerender();
    return;
  }

  if (!collapsed) {
    const section = fileSections.get(fileName);
    const index = state.files.findIndex((f) => f.name === fileName);
    if (section && index >= 0) {
      const indexedFile = state.files[index];
      if (indexedFile) instantiateFileDiff(app, indexedFile, index, section);
    }
  }
}

function instantiateFileDiff(app: App, file: FileDiffMetadata, index: number, section: HTMLElement): void {
  const { state, fileDiffInstances } = app;
  if (isBinaryPlaceholder(file) || fileDiffInstances.has(file.name)) return;
  const collapsed = isFileCollapsed(app, file.name);
  const instance = new FileDiff({
    diffStyle: state.diffStyle,
    ...highlighterOptions,
    collapsed,
    themeType: "dark",
    hunkSeparators: "simple",
    enableGutterUtility: true,
    enableLineSelection: true,
    lineHoverHighlight: "both",
    overflow: "wrap",
    unsafeCSS: FILE_DIFF_HEADER_CSS,
    renderHeaderPrefix: () => makeCollapseChevron(app, file.name),
    onGutterUtilityClick: (range) => startComment(app, file, range),
    onLineSelected: (range) => { if (range) startComment(app, file, range, true); },
    renderAnnotation: (annotation: DiffLineAnnotation<AnnotationMetadata>) => renderComment(app, annotation),
  }, workerPool);
  fileDiffInstances.set(file.name, instance);
  instance.render({ fileDiff: file, lineAnnotations: commentsForFile(app, file), containerWrapper: section });
}

export function setFileCollapsed(app: App, fileName: string, collapsed: boolean): void {
  if (collapsed) app.state.collapsedFiles.add(fileName);
  else app.state.collapsedFiles.delete(fileName);
  applyFileCollapse(app, fileName, collapsed);
}

export function toggleFileCollapsed(app: App, fileName: string): void {
  setFileCollapsed(app, fileName, !isFileCollapsed(app, fileName));
  refreshFilePanelToolbar(app);
}

export function toggleAllFilePanels(app: App): void {
  const next = !isAllCollapsed(app);
  setAllCollapsed(app, next);
  refreshFilePanelToolbar(app);
  for (const file of app.state.files) applyFileCollapse(app, file.name, next);
}

export function refreshFilePanelToolbar(app: App): void {
  const ui = getUi(app);
  const all = isAllCollapsed(app);
  ui.collapseButton.setAttribute("aria-label", all ? "Expand all files" : "Collapse all files");
  ui.collapseButton.setAttribute("aria-pressed", String(all));
  ui.collapseButton.replaceChildren(
    icon(`<path d="${all ? "M4 6l4 4 4-4" : "M4 10l4-4 4 4"}" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`),
  );

  const isSplit = app.state.diffStyle === "split";
  ui.diffStyleButton.setAttribute("aria-label", isSplit ? "Switch to unified view" : "Switch to split view");
  ui.diffStyleButton.replaceChildren(
    isSplit
      ? icon('<path d="M3 4h10M3 8h10M3 12h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>')
      : icon('<path d="M3 3.5h4v9H3zM9 3.5h4v9H9z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M4.5 6h1M10.5 6h1M4.5 8h1M10.5 8h1M4.5 10h1M10.5 10h1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'),
  );
}

export function toggleDiffStyle(app: App): void {
  const { state, fileDiffInstances } = app;
  state.diffStyle = state.diffStyle === "split" ? "unified" : "split";
  refreshFilePanelToolbar(app);
  for (const instance of fileDiffInstances.values()) {
    instance.setOptions({ ...instance.options, diffStyle: state.diffStyle });
    instance.rerender();
  }
}

export function renderFilePanels(app: App): void {
  const { state, fileSections, live } = app;
  const ui = getUi(app);
  ui.filesContent.replaceChildren();
  fileSections.clear();
  live.lazyObserver?.disconnect();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const section = entry.target as HTMLElement;
        const fileName = section.dataset.fileName;
        if (!fileName) continue;
        const index = state.files.findIndex((f) => f.name === fileName);
        if (index < 0) continue;
        const file = state.files[index];
        if (!file) continue;
        instantiateFileDiff(app, file, index, section);
        observer.unobserve(section);
      }
    },
    { root: ui.filesContainer, rootMargin: "200px" },
  );
  live.lazyObserver = observer;

  for (const file of state.files) {
    if (isBinaryPlaceholder(file)) {
      const section = buildBinaryPanel(app, file);
      fileSections.set(file.name, section);
      ui.filesContent.append(section);
      continue;
    }
    const section = el("section", { className: "filePanel", "data-file-name": file.name });
    fileSections.set(file.name, section);
    section.style.minHeight = FILE_HEADER_HEIGHT;
    attachHeaderToggle(app, section, file.name);
    observer.observe(section);
    ui.filesContent.append(section);
  }
}
