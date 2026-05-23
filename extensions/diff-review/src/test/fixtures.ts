import type { FileDiff } from "@pierre/diffs";
import type { Hunk, FileDiffMetadata } from "@pierre/diffs";
import type { AnnotationMetadata } from "../types";

export function makeHunk(overrides: Partial<Hunk> = {}): Hunk {
  return {
    additionStart: 1,
    additionCount: 5,
    deletionStart: 1,
    deletionCount: 5,
    additionLines: 2,
    deletionLines: 2,
    collapsedBefore: 0,
    additionLineIndex: 0,
    deletionLineIndex: 0,
    ...overrides,
  } as Hunk;
}

export function makeFile(name: string, hunks: Hunk[] = [makeHunk()]): FileDiffMetadata {
  return { name, hunks } as FileDiffMetadata;
}

export function mockFileDiff(
  overrides: Pick<FileDiff<AnnotationMetadata>, "setLineAnnotations" | "rerender">,
): FileDiff<AnnotationMetadata> {
  return {
    options: { collapsed: false },
    setOptions: () => {},
    render: () => true,
    cleanUp: () => {},
    ...overrides,
  } as unknown as FileDiff<AnnotationMetadata>;
}

export const SAMPLE_PATCH = `diff --git a/src/b.ts b/src/b.ts
index 1111111..2222222 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -1,2 +1,3 @@
 unchanged
+added

diff --git a/src/a.ts b/src/a.ts
index 3333333..4444444 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,3 @@
 keep
+line
`;

export const BINARY_PATCH = `diff --git a/logo.png b/logo.png
new file mode 100644
index 0000000..1111111
Binary files /dev/null and b/logo.png differ

${SAMPLE_PATCH}`;

export const SAMPLE_PAYLOAD = { cwd: "/repo", patch: SAMPLE_PATCH };
