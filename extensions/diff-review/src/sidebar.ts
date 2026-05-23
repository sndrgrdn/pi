import { computeFileStats } from "./diffUtils";
import type { App } from "./types";
import { getUi } from "./app";
import { el, icon } from "./dom";
import { FileTree } from "@pierre/trees";

function updateSidebarStats(app: App): void {
  const { state, live } = app;
  const stats = live.sidebarStats;
  if (!stats) return;
  const totals = state.files.reduce(
    (sum, file) => {
      const s = computeFileStats(file);
      return { additions: sum.additions + s.additions, deletions: sum.deletions + s.deletions };
    },
    { additions: 0, deletions: 0 },
  );
  stats.files.textContent = String(state.files.length);
  stats.additions.textContent = totals.additions.toLocaleString();
  stats.deletions.textContent = totals.deletions.toLocaleString();
  stats.lines.textContent = (totals.additions + totals.deletions).toLocaleString();
}

function scrollToPath(app: App, path: string): void {
  const { state, fileSections, live } = app;
  const index = state.files.findIndex((f) => f.name === path);
  if (index < 0) return;
  const file = state.files[index];
  if (!file) return;
  state.activeFileIndex = index;
  fileSections.get(file.name)?.scrollIntoView({ block: "start" });
  live.fileTree?.focusPath(file.name);
}

export function initSidebar(app: App): void {
  const { live } = app;
  const ui = getUi(app);
  const searchBtn = el("button", {
    className: "searchIcon",
    type: "button",
    "aria-label": "Search files",
    onclick: () => live.fileTree?.openSearch(),
  }, icon('<path d="M7 12a5 5 0 100-10 5 5 0 000 10zM10.8 10.8L14 14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'));

  live.sidebarStats = {
    files: el("dd"),
    additions: el("dd", { className: "additions" }),
    deletions: el("dd", { className: "deletions" }),
    lines: el("dd"),
  };

  const stats = el("div", { className: "sidebarStats" },
    el("dl", {},
      el("div", {}, el("dt", { textContent: "Files" }), live.sidebarStats.files),
      el("div", {}, el("dt", { textContent: "Additions" }), live.sidebarStats.additions),
      el("div", {}, el("dt", { textContent: "Deletions" }), live.sidebarStats.deletions),
      el("div", {}, el("dt", { textContent: "Lines" }), live.sidebarStats.lines),
    ),
  );

  ui.sidebar.append(el("div", { className: "sidebarTabs" }, searchBtn), ui.treeHost, stats);
}

export function renderFileTree(app: App): void {
  const { state, live } = app;
  const ui = getUi(app);
  if (state.files.length === 0) return;

  live.fileTree?.cleanUp();
  const activeFile = state.files[state.activeFileIndex];
  const tree = new FileTree({
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
    initialSelectedPaths: activeFile ? [activeFile.name] : [],
    initialVisibleRowCount: 80,
    onSelectionChange: (paths) => { const p = paths.at(-1); if (p) scrollToPath(app, p); },
    overscan: 18,
    search: true,
    unsafeCSS: `[data-file-tree-search-container][data-open='false'] { display: none; } [data-file-tree-search-container] { padding-bottom: 12px; margin-bottom: 12px; border-bottom: 1px solid var(--trees-border-color-override, var(--color-border)); }`,
  });
  live.fileTree = tree;
  tree.render({ containerWrapper: ui.treeHost });
  updateSidebarStats(app);
}

export function scrollToFile(app: App, index: number): void {
  const file = app.state.files[index];
  if (!file) return;
  scrollToPath(app, file.name);
}
