import type { FileDiffMetadata, Hunk, SelectedLineRange } from "@pierre/diffs";
import type { AnnotationSide } from "./types";
import type { FileStats } from "./types";

export function normalizeRange(range: SelectedLineRange): { side: AnnotationSide; start: number; end: number } | null {
  if (!range.side) return null;
  const side = range.side;
  if (range.endSide && range.endSide !== side) {
    return { side, start: range.start, end: range.start };
  }
  return { side, start: Math.min(range.start, range.end), end: Math.max(range.start, range.end) };
}

export function hunkContainsRange(hunk: Hunk, side: AnnotationSide, start: number, end: number): boolean {
  if (side === "additions") return start >= hunk.additionStart && end < hunk.additionStart + hunk.additionCount;
  return start >= hunk.deletionStart && end < hunk.deletionStart + hunk.deletionCount;
}

export function findHunkIndex(file: FileDiffMetadata, side: AnnotationSide, start: number, end: number): number {
  return file.hunks.findIndex((hunk) => hunkContainsRange(hunk, side, start, end));
}

export function isBinaryPlaceholder(file: FileDiffMetadata): boolean {
  return file.hunks.length === 0 && file.additionLines.length === 0 && file.deletionLines.length === 0;
}

export function computeFileStats(file: FileDiffMetadata): FileStats {
  return file.hunks.reduce<FileStats>(
    (s, h) => ({ additions: s.additions + h.additionLines, deletions: s.deletions + h.deletionLines }),
    { additions: 0, deletions: 0 },
  );
}

export function compareTreePaths(left: string, right: string): number {
  const l = left.toLowerCase().split("/");
  const r = right.toLowerCase().split("/");
  const depth = Math.min(l.length, r.length);
  for (let i = 0; i < depth; i++) {
    const leftPart = l[i];
    const rightPart = r[i];
    if (leftPart === undefined || rightPart === undefined) continue;
    if (leftPart === rightPart) continue;
    const lDir = i < l.length - 1;
    const rDir = i < r.length - 1;
    if (lDir !== rDir) return lDir ? -1 : 1;
    return leftPart.localeCompare(rightPart, undefined, { numeric: true });
  }
  return l.length - r.length || left.localeCompare(right, undefined, { numeric: true });
}
