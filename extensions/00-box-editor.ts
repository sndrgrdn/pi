import { type ExtensionAPI, type Theme } from "@mariozechner/pi-coding-agent";
import { visibleWidth } from "@mariozechner/pi-tui";

const ANSI_SGR_REGEX = /\x1b\[[^m]*m/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_SGR_REGEX, "");
}

// Wrap an editor's render method with our custom styling
function wrapRender(
  editor: any,
  ctx: any,
  theme: Theme,
  pi: ExtensionAPI
): void {
  if (editor._boxWrapped) return;
  editor._boxWrapped = true;

  const originalRender = editor.render.bind(editor);

  // Hardcoded "crust" color #181926
  const bgAnsi = "\x1b[48;2;24;25;38m";
  const floorFg = "\x1b[38;2;24;25;38m";

  const applyBg = (line: string, width: number): string => {
    const patched = line
      .replaceAll("\x1b[0m", "\x1b[0m" + bgAnsi)
      .replaceAll("\x1b[m", "\x1b[m" + bgAnsi)
      .replaceAll("\x1b[49m", "\x1b[49m" + bgAnsi);
    const w = visibleWidth(line);
    const pad = Math.max(0, width - w);
    return bgAnsi + patched + " ".repeat(pad);
  };

  editor.render = (width: number): string[] => {
    const parentLines = originalRender(width);
    const result: string[] = [];

    // Replace borders with bg blanks, apply bg to content lines
    for (const line of parentLines) {
      const raw = stripAnsi(line).trim();
      if (/^─+$/.test(raw)) {
        result.push(bgAnsi + " ".repeat(width));
      } else {
        result.push(applyBg(line, width));
      }
    }

    // Autocomplete spacer
    if (editor.isShowingAutocomplete?.()) {
      result.push(bgAnsi + " ".repeat(width));
    }

    // Model info line with padding
    const px = editor.getPaddingX?.() ?? 1;

    const provider = ctx?.model?.provider ?? "unknown";
    const model = ctx?.model?.name ?? ctx?.model?.id ?? "unknown";
    const hasThinking = ctx?.model?.reasoning;
    const level = pi?.getThinkingLevel?.() ?? "off";
    const dot = theme.fg("dim", " · ");

    let infoText = theme.fg("text", model) + dot + theme.fg("dim", provider);
    if (hasThinking && level !== "off") {
      const colorFn = theme.getThinkingBorderColor(level);
      infoText += dot + colorFn(level);
    }

    const leftPad = " ".repeat(px);
    const content = leftPad + infoText;
    result.push(applyBg(content, width));

    // Half-block floor
    result.push(floorFg + "▀".repeat(width) + "\x1b[39m");

    return result;
  };
}

let savedCtx: any;
let savedTheme: Theme;
let savedPi: ExtensionAPI;

export default function (pi: ExtensionAPI) {
  savedPi = pi;

  pi.on("session_start", (_event, ctx) => {
    savedCtx = ctx;
    savedTheme = ctx.ui.theme;

    // Intercept setEditorComponent to wrap any editor that gets set
    const originalSetEditor = ctx.ui.setEditorComponent.bind(ctx.ui);
    ctx.ui.setEditorComponent = (factory: any) => {
      if (!factory) {
        originalSetEditor(undefined);
        return;
      }

      // Wrap the factory to apply our render modifications
      originalSetEditor((tui: any, theme: any, kb: any) => {
        const editor = factory(tui, theme, kb);
        wrapRender(editor, savedCtx, savedTheme, savedPi);
        return editor;
      });
    };
  });
}
