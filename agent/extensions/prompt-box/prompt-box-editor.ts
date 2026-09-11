import { CustomEditor, type KeybindingsManager, type Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type EditorTheme, type TUI } from "@earendil-works/pi-tui";

/** Glyphs used to build the prompt-box border. */
export const BOX_GLYPHS = {
  tl: "╭",
  tr: "╮",
  bl: "╰",
  br: "╯",
  h: "─",
  v: "│",
  tee: "├",
  rtee: "┤",
};

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function padLine(text: string, width: number): string {
  const t = truncateToWidth(text, width, "");

  return t + " ".repeat(Math.max(0, width - visibleWidth(t)));
}

/** Builds one border with optional left and right labels. */
export function boxBorder(
  theme: Theme,
  left: string,
  right: string,
  corner: [left: string, right: string],
  width: number,
): string {
  const bdr = (s: string) => theme.fg("dim", s);
  const lPad = left ? ` ${left} ` : "";
  const lw = visibleWidth(lPad);
  const maxRightVis = width - 7 - lw;
  let rPad = "";

  if (right && maxRightVis > 2) {
    const truncRight = truncateToWidth(right, maxRightVis, "…");
    rPad = ` ${truncRight} ${bdr(BOX_GLYPHS.h)}`;
  }

  const rw = visibleWidth(rPad);
  const fill = Math.max(1, width - 3 - lw - rw);

  return (
    bdr(corner[0] + BOX_GLYPHS.h) + lPad + bdr(BOX_GLYPHS.h.repeat(fill)) + rPad + bdr(corner[1])
  );
}

/** Dynamic corner label providers, re-evaluated on every render. */
export interface CornerLabels {
  tl: () => string;
  tr: () => string;
  bl: () => string;
  br: () => string;
}

/** Editor with one border around its body and autocomplete suggestions. */
export class PromptBoxEditor extends CustomEditor {
  private readonly piTheme: Theme;
  private readonly corners: CornerLabels;

  constructor(
    tui: TUI,
    editorTheme: EditorTheme,
    keybindings: KeybindingsManager,
    piTheme: Theme,
    corners: CornerLabels,
  ) {
    super(tui, editorTheme, keybindings);
    this.piTheme = piTheme;
    this.corners = corners;
  }

  /** Delegates to CustomEditor below the minimum box width. */
  override render(width: number): string[] {
    if (width < 16) return super.render(width);

    const bdr = (s: string) => this.piTheme.fg("dim", s);
    const innerW = width - 4;
    const raw = super.render(innerW);

    if (raw.length < 2) return raw;

    let ruleIdx = raw.length - 1;

    for (let i = raw.length - 1; i > 0; i--) {
      if ((raw[i] ?? "").replace(ANSI_RE, "").trim().startsWith("─")) {
        ruleIdx = i;
        break;
      }
    }

    const body = raw.slice(1, ruleIdx);
    const acLines = raw.slice(ruleIdx + 1);

    const wrap = (line: string) =>
      `${bdr(BOX_GLYPHS.v)} ${padLine(line, innerW)} ${bdr(BOX_GLYPHS.v)}`;

    const top = boxBorder(
      this.piTheme,
      this.corners.tl(),
      this.corners.tr(),
      [BOX_GLYPHS.tl, BOX_GLYPHS.tr],
      width,
    );

    const bodyLines = body.length > 0 ? [...body] : [""];

    while (bodyLines.length < 2) bodyLines.push("");

    const lines = [top, ...bodyLines.map(wrap)];

    if (acLines.length > 0) {
      lines.push(bdr(`${BOX_GLYPHS.tee}${BOX_GLYPHS.h.repeat(width - 2)}${BOX_GLYPHS.rtee}`));
      lines.push(...acLines.map(wrap));
    }

    lines.push(
      boxBorder(
        this.piTheme,
        this.corners.bl(),
        this.corners.br(),
        [BOX_GLYPHS.bl, BOX_GLYPHS.br],
        width,
      ),
    );

    return lines;
  }
}
