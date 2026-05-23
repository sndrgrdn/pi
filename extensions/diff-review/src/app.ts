import type { App, ShellRefs, State } from "./types";

function createInitialState(): State {
  return {
    files: [],
    annotations: [],
    draft: null,
    draftBody: "",
    diffStyle: "unified",
    activeFileIndex: 0,
    reviewOpen: false,
    submitting: false,
    submitted: false,
    summary: "",
    collapsedFiles: new Set(),
  };
}

export function createApp(token: string): App {
  return {
    token,
    state: createInitialState(),
    ui: null,
    fileDiffInstances: new Map(),
    fileSections: new Map(),
    live: { fileTree: null, lazyObserver: null, sidebarStats: null },
  };
}

export function getUi(app: App): ShellRefs {
  if (!app.ui) throw new Error("UI not bound");
  return app.ui;
}

export function resetAppState(app: App): void {
  Object.assign(app.state, createInitialState());
  app.fileDiffInstances.clear();
  app.fileSections.clear();
  app.live.fileTree?.cleanUp();
  app.live.fileTree = null;
  app.live.lazyObserver?.disconnect();
  app.live.lazyObserver = null;
  app.live.sidebarStats = null;
}

export function cleanupApp(app: App): void {
  app.live.fileTree?.cleanUp();
  app.fileDiffInstances.forEach((inst) => inst.cleanUp());
  app.live.lazyObserver?.disconnect();
}
