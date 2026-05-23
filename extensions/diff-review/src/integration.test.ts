import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { commitComment, startComment } from "./comment";
import { compareTreePaths, isBinaryPlaceholder, normalizeRange } from "./diffUtils";
import { toggleAllFilePanels } from "./filePanel";
import { canSubmitReview } from "./reviewContract";
import { submitReview } from "./review";
import { createReviewShell } from "./reviewShell";
import { FileDiff as FileDiffCtor } from "@pierre/diffs";
import { makeFile, mockFileDiff, SAMPLE_PAYLOAD, BINARY_PATCH } from "./test/fixtures";
import { initShell, resetAppState } from "./test/shell";

vi.mock("@pierre/diffs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pierre/diffs")>();
  return {
    ...actual,
    FileDiff: vi.fn().mockImplementation(() => ({
      options: { collapsed: false },
      setOptions: vi.fn(),
      rerender: vi.fn(),
      render: vi.fn(),
      cleanUp: vi.fn(),
      setLineAnnotations: vi.fn(),
    })),
  };
});

vi.mock("@pierre/trees", () => ({
  FileTree: class {
    render = vi.fn();
    cleanUp = vi.fn();
    openSearch = vi.fn();
    focusPath = vi.fn();
  },
}));

describe("diff + collapse", () => {
  let app = createApp("test");

  beforeEach(() => {
    app = createApp("test");
    resetAppState(app);
  });

  it("normalizes ranges and tracks collapse", () => {
    expect(normalizeRange({ side: "additions", start: 10, end: 7 })).toEqual({ side: "additions", start: 7, end: 10 });
    expect(compareTreePaths("src/2.ts", "src/10.ts")).toBeLessThan(0);

    initShell(app);
    app.state.files = [makeFile("a.ts"), makeFile("b.ts")];
    toggleAllFilePanels(app);
    expect(app.state.collapsedFiles.size).toBe(2);
  });
});

describe("inline comments", () => {
  let app = createApp("test");

  beforeEach(() => {
    app = createApp("test");
    initShell(app);
    resetAppState(app);
  });

  it("commits a draft as an annotation on the diff", () => {
    const file = makeFile("src/a.ts");
    app.state.files = [file];
    const rerender = vi.fn();
    app.fileDiffInstances.set("src/a.ts", mockFileDiff({ setLineAnnotations: vi.fn(), rerender }));

    startComment(app, file, { side: "additions", start: 2, end: 2 });
    app.state.draftBody = "ship it";
    commitComment(app);

    expect(app.state.annotations[0]?.body).toBe("ship it");
    expect(rerender).toHaveBeenCalled();
  });
});

describe("review flow", () => {
  let app = createApp("test");

  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    app = createApp("test");
    initShell(app);
    resetAppState(app);
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("alert", vi.fn());
    vi.stubGlobal("IntersectionObserver", class {
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
    });
  });

  it("builds the shell and posts review to pi", async () => {
    createReviewShell(app).mount(SAMPLE_PAYLOAD);

    expect(document.querySelector(".toolbar")).not.toBeNull();
    expect(document.querySelector(".fileSidebar")).not.toBeNull();
    expect(app.state.files.map((f) => f.name)).toEqual(["src/a.ts", "src/b.ts"]);

    app.state.annotations = [{ id: "1", file: "src/a.ts", side: "additions", startLine: 1, endLine: 1, body: "nit" }];
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);

    submitReview(app, "comment");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/submit"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("blocks empty comment reviews but allows empty approve", () => {
    expect(canSubmitReview({ decision: "approve", summary: "", annotations: [] })).toBe(true);
    expect(canSubmitReview({ decision: "comment", summary: "", annotations: [] })).toBe(false);
    expect(canSubmitReview({ decision: "request-changes", summary: "", annotations: [] })).toBe(false);

    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);
    submitReview(app, "comment");
    expect(fetch).not.toHaveBeenCalled();

    submitReview(app, "approve");
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe("binary files", () => {
  let app = createApp("test");

  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    app = createApp("test");
    initShell(app);
    resetAppState(app);
    vi.mocked(FileDiffCtor).mockClear();
    vi.stubGlobal("IntersectionObserver", class {
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
    });
  });

  it("lists binary files in tree without rendering FileDiff", () => {
    createReviewShell(app).mount({ cwd: "/repo", patch: BINARY_PATCH });

    expect(app.state.files.some((f) => f.name === "logo.png")).toBe(true);
    expect(isBinaryPlaceholder(app.state.files.find((f) => f.name === "logo.png")!)).toBe(true);
    expect(document.querySelector(".filePanelBinary")).not.toBeNull();
    expect(FileDiffCtor).not.toHaveBeenCalled();
  });
});
