import type { App } from "./types";
import { getUi, resetAppState } from "./app";
import { parseDiffPayload } from "./diff";
import { el } from "./dom";
import { renderFilePanels, refreshFilePanelToolbar, toggleAllFilePanels, toggleDiffStyle } from "./filePanel";
import { handleKeydown } from "./keyboard";
import { initSidebar, renderFileTree } from "./sidebar";
import { showReviewModal } from "./review";
import type { DiffPayload } from "./types";

export type ReviewShell = {
  mount(payload: DiffPayload): void;
};

export function createReviewShell(app: App): ReviewShell {
  const onKeydown = (event: KeyboardEvent) => handleKeydown(app, event);
  let keydownBound: ((event: KeyboardEvent) => void) | null = null;

  return {
    mount(payload: DiffPayload) {
      const root = document.getElementById("root");
      if (!root) throw new Error("Missing #root");

      resetAppState(app);
      const files = parseDiffPayload(payload);
      app.state.files = files;

      if (files.length === 0) {
        root.replaceChildren(el("main", { className: "shell" }, el("p", { textContent: "No changes to review" })));
        return;
      }

      root.replaceChildren();

      const filesContent = el("div", { className: "filesContent" });
      app.ui = {
        diffStyleButton: el("button", { className: "iconButton", type: "button", onclick: () => toggleDiffStyle(app) }),
        collapseButton: el("button", { className: "iconButton", type: "button", onclick: () => toggleAllFilePanels(app) }),
        reviewButton: el("button", { className: "reviewButton", onclick: () => showReviewModal(app) }, "Review"),
        sidebar: el("aside", { className: "fileSidebar", "aria-label": "Changed files" }),
        treeHost: el("div", { className: "treeHost" }),
        filesContent,
        filesContainer: el("div", { className: "files" }, filesContent),
        modalLayer: el("div", { className: "modalLayer" }),
      };
      const ui = getUi(app);
      ui.modalLayer.style.display = "none";
      const shellMain = el("main", { className: "shell" }, el("h1", { className: "srOnly", textContent: "Diff Review" }));
      const toolbar = el("header", { className: "toolbar" },
        el("input", { className: "repoInput", readonly: true, value: payload.cwd, "aria-label": "Repository path" }),
        el("div", { className: "toolbarRight" }, ui.diffStyleButton, ui.collapseButton, ui.reviewButton),
      );
      refreshFilePanelToolbar(app);

      initSidebar(app);
      renderFileTree(app);

      const layout = el("div", { className: "reviewLayout" }, ui.sidebar, ui.filesContainer);
      shellMain.append(toolbar, layout);
      root.append(shellMain, ui.modalLayer);

      renderFilePanels(app);
      if (keydownBound) document.removeEventListener("keydown", keydownBound);
      keydownBound = onKeydown;
      document.addEventListener("keydown", keydownBound);
    },
  };
}

export function showLoadingShell(): void {
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing #root");
  root.replaceChildren(el("main", { className: "shell" }, el("p", { textContent: "Loading diff…" })));
}

export function showErrorShell(message: string): void {
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing #root");
  root.replaceChildren(el("main", { className: "shell" }, el("p", { className: "error", textContent: message })));
}
