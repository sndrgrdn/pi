import { getOrCreateWorkerPoolSingleton } from "@pierre/diffs/worker";

export const workerFactory = () => new Worker(new URL("@pierre/diffs/worker/worker.js", import.meta.url), { type: "module" });

export const highlighterOptions = {
  lineDiffType: "word",
  theme: "catppuccin-macchiato",
  tokenizeMaxLineLength: 2000,
} as const satisfies {
  lineDiffType: "word";
  theme: "catppuccin-macchiato";
  tokenizeMaxLineLength: number;
};

export const workerPool = getOrCreateWorkerPoolSingleton({
  highlighterOptions,
  poolOptions: { poolSize: Math.min(4, navigator.hardwareConcurrency || 2), workerFactory },
});
