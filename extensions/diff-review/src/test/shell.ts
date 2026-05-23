import type { App } from "../types";
import { resetAppState } from "../app";

export function initShell(app: App): App {
  app.ui = {
    modalLayer: document.createElement("div"),
    sidebar: document.createElement("aside"),
    treeHost: document.createElement("div"),
    diffStyleButton: document.createElement("button"),
    collapseButton: document.createElement("button"),
    reviewButton: document.createElement("button"),
    filesContent: document.createElement("div"),
    filesContainer: document.createElement("div"),
  };
  return app;
}

export { resetAppState };
