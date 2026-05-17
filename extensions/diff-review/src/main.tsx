import { parsePatchFiles, type FileDiffMetadata, type Hunk, type SelectedLineRange } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { createRoot } from "react-dom/client";
import type { AnnotationSide, DiffPayload, ReviewAnnotation, ReviewDecision } from "./types";
import "./styles.css";

type Draft = {
  file: FileDiffMetadata;
  hunkIndex: number;
  range: SelectedLineRange;
};

type AnnotationMetadata = {
  id: string;
  body: string;
  startLine: number;
  endLine: number;
};

type DiffStyle = "unified" | "split";

type FileStats = {
  additions: number;
  deletions: number;
};

const params = new URLSearchParams(window.location.search);
const token = params.get("token") ?? "";

function normalizeRange(range: SelectedLineRange): { side: AnnotationSide; start: number; end: number } | null {
  if (!range.side) return null;
  if (range.endSide && range.endSide !== range.side) return null;
  return {
    side: range.side,
    start: Math.min(range.start, range.end),
    end: Math.max(range.start, range.end),
  };
}

function hunkContainsRange(hunk: Hunk, side: AnnotationSide, start: number, end: number): boolean {
  if (side === "additions") {
    return start >= hunk.additionStart && end < hunk.additionStart + hunk.additionCount;
  }
  return start >= hunk.deletionStart && end < hunk.deletionStart + hunk.deletionCount;
}

function findHunkIndex(file: FileDiffMetadata, side: AnnotationSide, start: number, end: number): number {
  return file.hunks.findIndex((hunk) => hunkContainsRange(hunk, side, start, end));
}


function isBinaryPlaceholder(file: FileDiffMetadata): boolean {
  return file.hunks.length === 0 && file.additionLines.length === 0 && file.deletionLines.length === 0;
}

function fileStats(file: FileDiffMetadata): FileStats {
  return file.hunks.reduce<FileStats>((stats, hunk) => ({
    additions: stats.additions + hunk.additionLines,
    deletions: stats.deletions + hunk.deletionLines,
  }), { additions: 0, deletions: 0 });
}

function App() {
  const [payload, setPayload] = useState<DiffPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<ReviewAnnotation[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [diffStyle, setDiffStyle] = useState<DiffStyle>("unified");
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeFileIndex, setActiveFileIndex] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [isFilePending, startFileTransition] = useTransition();

  useEffect(() => {
    fetch(`/api/diff?token=${encodeURIComponent(token)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        return response.json() as Promise<DiffPayload>;
      })
      .then(setPayload)
      .catch((error) => setLoadError(error instanceof Error ? error.message : String(error)));
  }, []);

  const files = useMemo(() => {
    if (!payload) return [];
    const parsed = parsePatchFiles(payload.patch, "pi-diffs", true);
    const visibleFiles: FileDiffMetadata[] = [];
    for (const patch of parsed) {
      for (const file of patch.files) {
        if (!isBinaryPlaceholder(file)) visibleFiles.push(file);
      }
    }
    return visibleFiles;
  }, [payload]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const inInput = tag === "TEXTAREA" || tag === "INPUT";

      if (e.key === "Escape") {
        if (draft) { setDraft(null); e.preventDefault(); }
        else if (reviewOpen) { setReviewOpen(false); e.preventDefault(); }
        else if (settingsOpen) { setSettingsOpen(false); e.preventDefault(); }
        return;
      }

      if (inInput) return;

      if (e.key === "ArrowDown" && files.length > 0) {
        e.preventDefault();
        startFileTransition(() => setActiveFileIndex(i => Math.min(i + 1, files.length - 1)));
      } else if (e.key === "ArrowUp" && files.length > 0) {
        e.preventDefault();
        startFileTransition(() => setActiveFileIndex(i => Math.max(i - 1, 0)));
      } else if (e.key === "r" && !e.metaKey && !e.ctrlKey && !reviewOpen) {
        e.preventDefault();
        setReviewOpen(true);
      } else if (e.key === "u") {
        setDiffStyle("unified");
      } else if (e.key === "s" && !settingsOpen) {
        setDiffStyle("split");
      } else if (e.key === "?") {
        e.preventDefault();
        alert("Shortcuts:\n↑/↓  Navigate files\nr    Review changes\nu    Unified view\ns    Split view\nEsc  Close modal\n⌘↵   Submit");
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [draft, reviewOpen, settingsOpen, files.length]);

  const fileStatsByName = useMemo(() => {
    const statsByName = new Map<string, FileStats>();
    for (const file of files) statsByName.set(file.name, fileStats(file));
    return statsByName;
  }, [files]);
  const activeFile = files[activeFileIndex] ?? files[0];
  const activeAnnotations = useMemo(() => {
    if (!activeFile) return [];
    return annotations.filter((annotation) => annotation.file === activeFile.name).map((annotation) => ({
      side: annotation.side,
      lineNumber: annotation.startLine,
      metadata: {
        id: annotation.id,
        body: annotation.body,
        startLine: annotation.startLine,
        endLine: annotation.endLine,
      },
    }));
  }, [activeFile, annotations]);
  const totals = useMemo(() => {
    const totals: FileStats = { additions: 0, deletions: 0 };
    for (const stats of fileStatsByName.values()) {
      totals.additions += stats.additions;
      totals.deletions += stats.deletions;
    }
    return totals;
  }, [fileStatsByName]);

  useEffect(() => {
    if (activeFileIndex >= files.length) setActiveFileIndex(Math.max(0, files.length - 1));
  }, [activeFileIndex, files.length]);

  const submit = async (selectedDecision: ReviewDecision) => {
    setSubmitting(true);
    try {
      const response = await fetch(`/api/submit?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-pi-diff-review-token": token },
        body: JSON.stringify({ decision: selectedDecision, summary, annotations }),
      });
      if (!response.ok) throw new Error(await response.text());
      setSubmitted(true);
      window.close();
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  if (loadError) return <main className="shell"><p className="error">{loadError}</p></main>;
  if (!payload) return <main className="shell"><p>Loading diff…</p></main>;

  return (
    <main className="shell">
      <h1 className="srOnly">Diff Review</h1>
      <header className="toolbar">
        <div className="toolbarLeft">
          <span className="repoLabel">{payload.cwd}</span>
          <span className="statSummary"><strong>{files.length}</strong> file{files.length === 1 ? "" : "s"} <span className="additions">+{totals.additions}</span> <span className="deletions">-{totals.deletions}</span></span>
        </div>
        <div className="toolbarRight">
          <div className="settingsWrapper" tabIndex={-1} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setSettingsOpen(false); }} onKeyDown={(e) => { if (e.key === "Escape") setSettingsOpen(false); }}>
            <button className="settingsToggle" type="button" aria-label="Diff settings" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(o => !o)}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path fillRule="evenodd" d="M7.429 1.525a3.5 3.5 0 011.142 0 .75.75 0 01.57.504l.345 1.14c.09.3.32.543.607.683a5.51 5.51 0 01.49.263c.27.165.594.232.906.16l1.17-.278a.75.75 0 01.726.2 6.5 6.5 0 01.572.99.75.75 0 01-.157.702l-.826.863a1.125 1.125 0 00-.29.78 5.5 5.5 0 010 .526c-.01.287.09.57.29.78l.826.862a.75.75 0 01.157.703 6.5 6.5 0 01-.572.99.75.75 0 01-.726.2l-1.17-.279a1.125 1.125 0 00-.906.161 5.5 5.5 0 01-.49.263c-.287.14-.517.383-.607.684l-.345 1.139a.75.75 0 01-.57.504 3.5 3.5 0 01-1.142 0 .75.75 0 01-.57-.504l-.345-1.14a1.125 1.125 0 00-.607-.683 5.5 5.5 0 01-.49-.263 1.125 1.125 0 00-.906-.16l-1.17.278a.75.75 0 01-.726-.2 6.5 6.5 0 01-.572-.99.75.75 0 01.157-.702l.826-.863c.2-.21.3-.493.29-.78a5.5 5.5 0 010-.526c.01-.287-.09-.57-.29-.78l-.826-.862a.75.75 0 01-.157-.703 6.5 6.5 0 01.572-.99.75.75 0 01.726-.2l1.17.279c.312.072.636.005.906-.161a5.5 5.5 0 01.49-.263c.287-.14.517-.383.607-.684l.345-1.139a.75.75 0 01.57-.504zM8 10a2 2 0 100-4 2 2 0 000 4z" /></svg>
            </button>
            {settingsOpen && (
              <div className="settingsPopover" role="menu">
                <div className="settingsGroup">
                  <span className="settingsLabel">Diff style</span>
                  <div className="segmented" role="tablist" aria-label="Diff view">
                    <button role="tab" aria-selected={diffStyle === "unified"} className={diffStyle === "unified" ? "active" : ""} type="button" onClick={() => setDiffStyle("unified")}>Unified</button>
                    <button role="tab" aria-selected={diffStyle === "split"} className={diffStyle === "split" ? "active" : ""} type="button" onClick={() => setDiffStyle("split")}>Split</button>
                  </div>
                </div>
              </div>
            )}
          </div>
          <button className="reviewButton" disabled={submitting || submitted} onClick={() => setReviewOpen(true)}>Review changes</button>
        </div>
      </header>

      <div className="reviewLayout" style={{ gridTemplateColumns: `${sidebarWidth}px 0 minmax(0, 1fr)` }}>
        <aside className="fileSidebar" aria-label="Changed files">
          <div className="sidebarFiles">
          {files.length === 0 ? <p>No changed files.</p> : files.map((file, index) => {
            const stats = fileStatsByName.get(file.name) ?? { additions: 0, deletions: 0 };
            return (
              <button className={index === activeFileIndex ? "active" : ""} disabled={isFilePending && index === activeFileIndex} key={`${file.prevName ?? ""}->${file.name}`} type="button" onClick={() => startFileTransition(() => setActiveFileIndex(index))}>
                <span>{file.name}</span>
                <small>{file.prevName ? `from ${file.prevName} · ` : ""}<span className="additions">+{stats.additions}</span> <span className="deletions">-{stats.deletions}</span></small>
              </button>
            );
          })}
          </div>
        </aside>

        <div
          className="resizeHandle"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onPointerDown={(e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startW = sidebarWidth;
            const onMove = (ev: PointerEvent) => setSidebarWidth(Math.max(140, Math.min(480, startW + ev.clientX - startX)));
            const onUp = () => { document.removeEventListener("pointermove", onMove); document.removeEventListener("pointerup", onUp); document.body.style.cursor = ""; document.body.style.userSelect = ""; };
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
            document.addEventListener("pointermove", onMove);
            document.addEventListener("pointerup", onUp);
          }}
        />

        <div className="files">
          {activeFile ? (
            <section className="filePanel" key={`${activeFile.prevName ?? ""}->${activeFile.name}:${diffStyle}`}>
              <FileDiff<AnnotationMetadata>
                fileDiff={activeFile}
            lineAnnotations={activeAnnotations}
            options={{
              diffStyle,
              theme: "catppuccin-macchiato",
              themeType: "dark",
              hunkSeparators: "simple",
              enableGutterUtility: true,
              enableLineSelection: true,
              lineHoverHighlight: "both",
              overflow: "wrap",
              lineDiffType: "none",
              tokenizeMaxLineLength: 2000,
              onGutterUtilityClick: (range) => {
                const normalized = normalizeRange(range);
                if (!normalized) return;
                const hunkIndex = findHunkIndex(activeFile, normalized.side, normalized.start, normalized.end);
                if (hunkIndex < 0) return;
                setDraft({ file: activeFile, hunkIndex, range });
                setDraftBody("");
              },
              onLineSelected: (range) => {
                if (!range) return;
                const normalized = normalizeRange(range);
                if (!normalized) return alert("Select lines on one side only.");
                const hunkIndex = findHunkIndex(activeFile, normalized.side, normalized.start, normalized.end);
                if (hunkIndex < 0) return alert("Select lines within one visible hunk.");
                setDraft({ file: activeFile, hunkIndex, range });
                setDraftBody("");
              },
            }}
                renderAnnotation={(annotation) => {
                  const metadata = annotation.metadata;
                  if (!metadata) return null;
                  return <div className="annotation"><strong>{metadata.startLine === metadata.endLine ? `Line ${metadata.startLine}` : `Lines ${metadata.startLine}-${metadata.endLine}`}</strong><p>{metadata.body}</p></div>;
                }}
              />
            </section>
          ) : null}
        </div>
      </div>

      {reviewOpen ? <div className="modalBackdrop" onClick={() => setReviewOpen(false)}>
        <div className="reviewModal" onClick={(event) => event.stopPropagation()}>
          <header>
            <h2>Finish your review</h2>
            <p>{annotations.length} pending comment{annotations.length === 1 ? "" : "s"}</p>
          </header>
          <textarea autoFocus aria-label="Review summary" value={summary} onChange={(event) => setSummary(event.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && e.metaKey) { e.preventDefault(); submit("comment"); } }} placeholder="Leave a summary comment…" />
          <div className="modalActions">
            <button className="danger" type="button" disabled={submitting || submitted} onClick={() => submit("request-changes")}>Request changes</button>
            <button className="primary" type="button" disabled={submitting || submitted} onClick={() => submit("approve")}>Approve</button>
            <button type="button" disabled={submitting || submitted} onClick={() => submit("comment")}>Comment</button>
          </div>
        </div>
      </div> : null}

      {draft ? <div className="modalBackdrop" onClick={() => setDraft(null)}>
        <form className="modal" onSubmit={(event) => {
          event.preventDefault();
          const normalized = normalizeRange(draft.range);
          if (!normalized || !draftBody.trim()) return;
          const id = crypto.randomUUID();
          setAnnotations((current) => [...current, {
            id,
            file: draft.file.name,
            previousFile: draft.file.prevName,
            side: normalized.side,
            startLine: normalized.start,
            endLine: normalized.end,
            body: draftBody.trim(),
          }]);
          setDraft(null);
          setDraftBody("");
        }} onClick={(event) => event.stopPropagation()}>
          <h2>Add annotation</h2>
          <textarea autoFocus aria-label="Annotation body" value={draftBody} onChange={(event) => setDraftBody(event.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && e.metaKey && draftBody.trim()) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} placeholder="Describe what Pi should evaluate or change…" />
          <div className="modalActions">
            <button type="button" onClick={() => setDraft(null)}>Cancel</button>
            <button className="primary" type="submit" disabled={!draftBody.trim()}>Add</button>
          </div>
        </form>
      </div> : null}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
