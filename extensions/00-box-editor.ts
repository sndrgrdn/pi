import { CustomEditor, type ExtensionAPI, type ExtensionContext, type Theme } from "@mariozechner/pi-coding-agent";
import { visibleWidth } from "@mariozechner/pi-tui";

const ANSI_SGR_REGEX = /\x1b\[[^m]*m/g;
const BG_ANSI = "\x1b[48;2;24;25;38m";
const FLOOR_FG = "\x1b[38;2;24;25;38m";

function stripAnsi(s: string): string {
  return s.replace(ANSI_SGR_REGEX, "");
}

function applyBg(line: string, width: number): string {
  const patched = line
    .replaceAll("\x1b[0m", "\x1b[0m" + BG_ANSI)
    .replaceAll("\x1b[m", "\x1b[m" + BG_ANSI)
    .replaceAll("\x1b[49m", "\x1b[49m" + BG_ANSI);
  const w = visibleWidth(line);
  const pad = Math.max(0, width - w);
  return BG_ANSI + patched + " ".repeat(pad);
}

class BoxEditor extends CustomEditor {
  constructor(
    tui: any,
    editorTheme: any,
    keybindings: any,
    private readonly theme: Theme,
    private readonly getCtx: () => ExtensionContext | undefined,
    private readonly pi: ExtensionAPI
  ) {
    super(tui, editorTheme, keybindings);
  }

  render(width: number): string[] {
    const parentLines = super.render(width);
    const result: string[] = [];

    // Replace borders with bg blanks, apply bg to content lines.
    for (const line of parentLines) {
      const raw = stripAnsi(line).trim();
      if (/^─+$/.test(raw)) {
        result.push(BG_ANSI + " ".repeat(width));
      } else {
        result.push(applyBg(line, width));
      }
    }

    // Autocomplete spacer.
    if (this.isShowingAutocomplete?.()) {
      result.push(BG_ANSI + " ".repeat(width));
    }

    const ctx = this.getCtx();
    const px = this.getPaddingX?.() ?? 1;
    const provider = ctx?.model?.provider ?? "unknown";
    const model = ctx?.model?.name ?? ctx?.model?.id ?? "unknown";
    const hasThinking = ctx?.model?.reasoning;
    const level = this.pi.getThinkingLevel?.() ?? "off";
    const dot = this.theme.fg("dim", " · ");

    let infoText = this.theme.fg("text", model) + dot + this.theme.fg("dim", provider);
    if (hasThinking && level !== "off") {
      const colorFn = this.theme.getThinkingBorderColor(level);
      infoText += dot + colorFn(level);
    }

    result.push(applyBg(" ".repeat(px) + infoText, width));
    result.push(FLOOR_FG + "▀".repeat(width) + "\x1b[39m");

    return result;
  }
}

let savedCtx: ExtensionContext | undefined;

export default function (pi: ExtensionAPI) {
  pi.on("session_shutdown", () => {
    // ctx becomes stale after shutdown; its getters (e.g. ctx.model) throw.
    savedCtx = undefined;
  });

  pi.on("session_start", (_event, ctx) => {
    savedCtx = ctx;
    ctx.ui.setEditorComponent(
      (tui, editorTheme, keybindings) =>
        new BoxEditor(tui, editorTheme, keybindings, ctx.ui.theme, () => savedCtx, pi)
    );
  });
}
