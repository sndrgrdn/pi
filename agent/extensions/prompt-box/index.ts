/**
 * Bordered prompt box.
 *
 * ╭────────────────────────────────── Claude Opus 4.6 · high ─╮
 * │ type here_                                                │
 * ╰─ 69.6K · 99.21% ───────────────────── ~/.pi/agent (main) ─╯
 *
 * The editor draws the complete box; the footer stays empty.
 */
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { PromptBoxEditor } from "./prompt-box-editor.ts";

const THINK_LABEL = {
  off: "off",
  minimal: "min",
  low: "low",
  medium: "med",
  high: "high",
  xhigh: "xhi",
  max: "max",
} satisfies Record<string, string>;

/** Replaces the editor with a bordered prompt box for each session. */
export default function promptBox(pi: ExtensionAPI) {
  let branch: string | null = null;

  const tr = (ctx: ExtensionContext) => {
    const theme = ctx.ui.theme;
    const dot = theme.fg("dim", " · ");
    const parts: string[] = [];

    const model = ctx.model;
    const name = model?.name ?? model?.id ?? "unknown";
    parts.push(theme.fg("muted", name));

    if (model?.reasoning) {
      const level = ctx.thinkingLevel ?? "off";
      const label = THINK_LABEL[level] ?? level.slice(0, 3);
      const colorFn = theme.getThinkingBorderColor(level);
      parts.push(colorFn(label));
    }

    return parts.join(dot);
  };

  const bl = (ctx: ExtensionContext) => {
    const theme = ctx.ui.theme;
    const dot = theme.fg("dim", " · ");
    const parts: string[] = [];

    let tokens: number | undefined;

    try {
      const u = ctx.getContextUsage();
      tokens = u?.tokens ?? undefined;
    } catch {
      // Context usage may be unavailable (e.g. right after compaction); show "?".
    }

    const k = tokens ? `${(tokens / 1000).toFixed(1)}K` : "?";
    parts.push(theme.fg("dim", k));

    const hitRate = latestCacheHitRate(ctx.sessionManager.getEntries());

    if (hitRate !== undefined) {
      parts.push(theme.fg("dim", `${hitRate.toFixed(2)}%`));
    }

    return parts.join(dot);
  };

  const br = (ctx: ExtensionContext) => {
    const theme = ctx.ui.theme;
    const short = ctx.cwd.replace(process.env.HOME || "", "~");
    const text = branch ? `${short} (${branch})` : short;

    return theme.fg("dim", text);
  };

  pi.on("session_start", (_event, ctx) => {
    branch = null;

    ctx.ui.setFooter((tui, _theme, footerData) => {
      const refreshBranch = () => {
        branch = footerData.getGitBranch();
        tui.requestRender();
      };

      refreshBranch();

      return {
        dispose: footerData.onBranchChange(refreshBranch),
        invalidate() {},
        render() {
          return [];
        },
      };
    });

    ctx.ui.setEditorComponent((tui, editorTheme, keybindings) => {
      return new PromptBoxEditor(tui, editorTheme, keybindings, ctx.ui.theme, {
        tl: () => "",
        tr: () => tr(ctx),
        bl: () => bl(ctx),
        br: () => br(ctx),
      });
    });
  });

  pi.on("session_shutdown", () => {
    branch = null;
  });
}

/** Latest assistant-turn prompt-cache hit rate, if cache activity has been reported. */
export function latestCacheHitRate(entries: readonly SessionEntry[]): number | undefined {
  let rate: number | undefined;
  let reportedCache = false;

  for (const entry of entries) {
    if (entry.type !== "message" || entry.message.role !== "assistant") continue;
    const { input, cacheRead, cacheWrite } = entry.message.usage;
    reportedCache ||= cacheRead + cacheWrite > 0;
    const promptTokens = input + cacheRead + cacheWrite;
    rate = promptTokens > 0 ? (cacheRead / promptTokens) * 100 : undefined;
  }

  return reportedCache ? rate : undefined;
}
