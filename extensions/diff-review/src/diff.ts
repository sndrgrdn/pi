import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";
import { compareTreePaths } from "./diffUtils";
import type { DiffPayload } from "./types";

export function parseDiffPayload(payload: DiffPayload): FileDiffMetadata[] {
  const parsed = parsePatchFiles(payload.patch, "pi-diffs", true);
  const files: FileDiffMetadata[] = [];
  for (const patch of parsed) {
    for (const file of patch.files) files.push(file);
  }
  return files.sort((a, b) => compareTreePaths(a.name, b.name));
}
