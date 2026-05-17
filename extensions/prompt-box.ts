/**
 * Bordered prompt box.
 *
 * ╭─────────────────────── Opus 4──◕ med ─╮
 * │ type here_                            │
 * │                                       │
 * │                                       │
 * ╰─ 42.3K (18%) ──── ~/code/tuna (main) ─╯
 *
 * tl:              tr: model──thinking icon
 * bl: tokens        br: cwd (branch)
 */

import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import {
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";

// ── Box-drawing ──────────────────────────────

const B = { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│", tee: "├", rtee: "┤" };

// ── Thinking glyphs ──────────────────────────

const THINK_LABEL: Record<string, string> = {
  off: "off", minimal: "min", low: "low", medium: "med", high: "high", xhigh: "max",
};

// ── Helpers ──────────────────────────────────

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function padLine(text: string, width: number): string {
  const t = truncateToWidth(text, width, "");
  return t + " ".repeat(Math.max(0, width - visibleWidth(t)));
}

function getEditorPaddingX(): number {
  try {
    const agentDir = process.env.PI_CODING_AGENT_DIR ?? `${process.env.HOME}/.pi/agent`;
    const raw = readFileSync(`${agentDir}/settings.json`, "utf8");
    const settings = JSON.parse(raw) as { editorPaddingX?: unknown };
    if (typeof settings.editorPaddingX === "number" && Number.isFinite(settings.editorPaddingX)) {
      return Math.max(0, settings.editorPaddingX);
    }
  } catch {}
  return 1;
}

// ── Editor ───────────────────────────────────

class PromptBoxEditor extends CustomEditor {
  private readonly piTheme: Theme;
  private readonly getTL: () => string;
  private readonly getTR: () => string;
  private readonly getBL: () => string;
  private readonly getBR: () => string;

  constructor(
    tui: any, editorTheme: any, keybindings: any,
    piTheme: Theme,
    getTL: () => string, getTR: () => string,
    getBL: () => string, getBR: () => string,
    opts: { paddingX: number },
  ) {
    super(tui, editorTheme, keybindings, { paddingX: opts.paddingX });
    this.piTheme = piTheme;
    this.getTL = getTL;
    this.getTR = getTR;
    this.getBL = getBL;
    this.getBR = getBR;
  }

  refresh(): void { this.tui.requestRender(); }

  private border(left: string, right: string, corner: [string, string], width: number): string {
    const bdr = (s: string) => this.piTheme.fg("dim", s);
    const lPad = left ? ` ${left} ` : "";
    const lw = visibleWidth(lPad);
    // budget: corners(3) + lPad + fill(≥1) + rPad + rPad overhead(3: sp + sp + ─)
    const maxRightVis = width - 7 - lw;
    let rPad = "";
    if (right && maxRightVis > 2) {
      const truncRight = truncateToWidth(right, maxRightVis, "…");
      rPad = ` ${truncRight} ${bdr(B.h)}`;
    }
    const rw = visibleWidth(rPad);
    const fill = Math.max(1, width - 3 - lw - rw);
    return bdr(corner[0] + B.h) + lPad + bdr(B.h.repeat(fill)) + rPad + bdr(corner[1]);
  }

  override render(width: number): string[] {
    if (width < 16) return super.render(width);

    const bdr = (s: string) => this.piTheme.fg("dim", s);
    const innerW = width - 4; // │ sp content sp │
    const raw = super.render(innerW);
    if (raw.length < 2) return raw;

    // find closing rule (autocomplete sits after it)
    let ruleIdx = raw.length - 1;
    for (let i = raw.length - 1; i > 0; i--) {
      if (raw[i]!.replace(ANSI_RE, "").trim().startsWith("─")) { ruleIdx = i; break; }
    }
    const body = raw.slice(1, ruleIdx);
    const acLines = raw.slice(ruleIdx + 1);

    const wrap = (line: string) =>
      `${bdr(B.v)} ${padLine(line, innerW)} ${bdr(B.v)}`;

    const top = this.border(this.getTL(), this.getTR(), [B.tl, B.tr], width);
    const bot = this.border(this.getBL(), this.getBR(), [B.bl, B.br], width);
    const bodyLines = body.length > 0 ? [...body] : [""];
    while (bodyLines.length < 3) bodyLines.push("");

    const lines = [top, ...bodyLines.map(wrap)];
    if (acLines.length > 0) {
      lines.push(bdr(`${B.tee}${B.h.repeat(width - 2)}${B.rtee}`));
      lines.push(...acLines.map(wrap));
    }
    lines.push(bot);
    return lines;
  }
}

// ── Extension ────────────────────────────────

export default function promptBox(pi: ExtensionAPI) {
  let editor: PromptBoxEditor | undefined;
  let branch: string | null = null;

  // ── tr: model · thinking ─────────

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

    return parts.join(dot);
  };

  // ── bl: tokens ───────────────────

  const bl = (ctx: ExtensionContext) => {
    const theme = ctx.ui.theme;
    let tokens: number | undefined;
    let pct: number | undefined;
    try {
      const u = ctx.getContextUsage();
      tokens = u?.tokens ?? undefined;
      pct = u?.percent != null ? Math.round(u.percent) : undefined;
    } catch {}
    const k = tokens ? (tokens / 1000).toFixed(1) + "K" : "?";
    return theme.fg("dim", `${k} (${pct ?? "?"}%)`);
  };

  // ── br: cwd (branch) ─────────────

  const br = (_ctx: ExtensionContext) => {
    const theme = _ctx.ui.theme;
    const short = _ctx.cwd.replace(process.env.HOME || "", "~");
    const text = branch ? `${short} (${branch})` : short;
    return theme.fg("dim", text);
  };

  // ── lifecycle ────────────────────

  pi.on("session_start", (_event, ctx) => {
    branch = null;

    // empty footer — setFooter(undefined) restores built-in
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
        () => "", () => tr(ctx),
        () => bl(ctx), () => br(ctx),
        { paddingX: px },
      );
      return editor;
    });
  });

  pi.on("session_shutdown", () => {
    branch = null;
    editor = undefined;
  });
}
