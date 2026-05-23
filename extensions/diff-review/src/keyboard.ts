import type { App } from "./types";
import { discardComment } from "./comment";
import { toggleDiffStyle } from "./filePanel";
import { isHTMLElement } from "./guards";
import { hideReviewModal, showReviewModal } from "./review";
import { scrollToFile } from "./sidebar";

export function handleKeydown(app: App, e: KeyboardEvent): void {
  const { state, live } = app;
  const target = e.target;
  const inInput = isHTMLElement(target) && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
  if (inInput && e.key !== "Escape" && !e.metaKey) return;

  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      scrollToFile(app, Math.min(state.activeFileIndex + 1, state.files.length - 1));
      break;
    case "ArrowUp":
      e.preventDefault();
      scrollToFile(app, Math.max(state.activeFileIndex - 1, 0));
      break;
    case "u":
      e.preventDefault();
      if (state.diffStyle !== "unified") toggleDiffStyle(app);
      break;
    case "s":
      e.preventDefault();
      if (state.diffStyle !== "split") toggleDiffStyle(app);
      break;
    case "r":
      if (e.metaKey || e.ctrlKey) break;
      e.preventDefault();
      if (!state.reviewOpen) showReviewModal(app);
      break;
    case "Escape":
      e.preventDefault();
      if (state.reviewOpen) hideReviewModal(app);
      else if (state.draft) discardComment(app);
      break;
    case "/":
      e.preventDefault();
      live.fileTree?.openSearch();
      break;
    case "?":
      e.preventDefault();
      alert("Keyboard shortcuts:\n\n↓  Next file\n↑  Previous file\nu  Unified view\ns  Split view\nr  Open review\n/  Search files\nEsc  Close modal / draft\n?  This help");
      break;
  }
}
