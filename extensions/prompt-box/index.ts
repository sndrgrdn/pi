/**
 * Bordered prompt box with streaming metrics.
 *
 * ╭────────────────────────────────────────────────── Claude Opus 4.6 · high ─╮
 * │ type here_                                                                │
 * │                                                                           │
 * ╰─ 69.6K (69%) · 0.69s · 69 tok/s ──────────────────────────── ~/.pi/agent ─╯
 *
 * tl: (empty)       tr: model · thinking
 * bl: tokens · metrics  br: cwd (branch)
 */
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { PromptBoxEditor, getEditorPaddingX } from "./editor.js";
import { register as registerMetrics, getMetrics, onUpdate } from "./metrics.js";

// ── Thinking glyphs ──────────────────────────

const THINK_LABEL: Record<string, string> = {
  off: "off", minimal: "min", low: "low", medium: "med", high: "high", xhigh: "xhi", max: "max",
};

/** Named Mode replaces model/thinking; null preserves prompt-box's display. */
export function selectTopRightParts(parts: string[], mode: string | null): string[] {
  return mode === null ? parts : [mode];
}

// ── Extension ────────────────────────────────

export default function promptBox(pi: ExtensionAPI) {
  let editor: PromptBoxEditor | undefined;
  let branch: string | null = null;
  let unsubMetrics: (() => void) | undefined;
  let harnessMode: string | null = null;

  // Wire up the metrics module
  registerMetrics(pi);

  // Active harness Mode (published by extensions/harness modes.ts).
  pi.events.on("harness:mode", (mode: unknown) => {
    harnessMode = typeof mode === "string" ? mode : null;
    editor?.refresh();
  });

  // ── tr: model · thinking · mode ──

  const tr = (ctx: ExtensionContext) => {
    const theme = ctx.ui.theme;
    const dot = theme.fg("dim", " · ");
    const parts: string[] = [];

    const model = ctx.model;
    const name = model?.name ?? model?.id ?? "unknown";
    parts.push(theme.fg("muted", name));

    if (model?.reasoning) {
      const level = pi.getThinkingLevel?.() ?? "off";
      const label = THINK_LABEL[level] ?? level.slice(0, 3);
      const colorFn = theme.getThinkingBorderColor(level);
      parts.push(colorFn(label));
    }

    const displayed = selectTopRightParts(parts, harnessMode);
    if (harnessMode !== null) displayed[0] = theme.fg("accent", harnessMode);
    return displayed.join(dot);
  };

  // ── bl: tokens + metrics ─────────

  const bl = (ctx: ExtensionContext) => {
    const theme = ctx.ui.theme;
    const dot = theme.fg("dim", " · ");
    const parts: string[] = [];

    // context usage
    let tokens: number | undefined;
    let pct: number | undefined;
    try {
      const u = ctx.getContextUsage();
      tokens = u?.tokens ?? undefined;
      pct = u?.percent != null ? Math.round(u.percent) : undefined;
    } catch {}
    const k = tokens ? (tokens / 1000).toFixed(1) + "K" : "?";
    parts.push(theme.fg("dim", `${k} (${pct ?? "?"}%)`));

    // streaming metrics
    const m = getMetrics();
    if (m.latest) {
      parts.push(theme.fg("dim", `${m.latest.ttft.toFixed(2)}s`));
      parts.push(theme.fg("dim", `${m.latest.tokSec.toFixed(0)} tok/s`));
    } else if (m.live) {
      parts.push(theme.fg("dim", `${m.live.ttft.toFixed(2)}s`));
    }

    return parts.join(dot);
  };

  // ── br: cwd (branch) ─────────────

  const br = (ctx: ExtensionContext) => {
    const theme = ctx.ui.theme;
    const short = ctx.cwd.replace(process.env.HOME || "", "~");
    const text = branch ? `${short} (${branch})` : short;
    return theme.fg("dim", text);
  };

  // ── lifecycle ────────────────────

  pi.on("session_start", (_event, ctx) => {
    branch = null;

    // Harness announces on its own session_start; request covers reloads
    // and any ordering where we missed the announcement.
    pi.events.emit("harness:mode:request", undefined);

    // Subscribe to metrics changes for UI refresh
    unsubMetrics = onUpdate(() => editor?.refresh());

    // Empty footer — setFooter(undefined) restores built-in
    ctx.ui.setFooter((tui, _theme, footerData) => {
      const refreshBranch = () => {
        branch = footerData.getGitBranch();
        tui.requestRender();
      };
      refreshBranch();
      return {
        dispose: footerData.onBranchChange(refreshBranch),
        invalidate() {},
        render() { return []; },
      };
    });

    const px = getEditorPaddingX();
    ctx.ui.setEditorComponent((tui, editorTheme, keybindings) => {
      editor = new PromptBoxEditor(
        tui, editorTheme, keybindings, ctx.ui.theme,
        { tl: () => "", tr: () => tr(ctx), bl: () => bl(ctx), br: () => br(ctx) },
        { paddingX: px },
      );
      return editor;
    });
  });

  pi.on("session_shutdown", () => {
    branch = null;
    editor = undefined;
    unsubMetrics?.();
    unsubMetrics = undefined;
  });
}
