/**
 * Shared result-slot rendering for the web and bash tool rows (ported from
 * opencode V2's per-tool display rules): a completed tool shows only its
 * start line; expanding the row reveals a capped preview.
 */

import type { AgentToolResult, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

/** A zero-size empty Text for renderers that always need a slot. */
export const emptyToolResult = (): Text => new Text("", 0, 0);

/** The failure message; pi already colors the box background. */
export function toolErrorResult(
  result: AgentToolResult<unknown>,
  icon: string,
  theme: Theme,
): Text {
  const message = result.content[0]?.type === "text" ? result.content[0].text : "Tool failed";

  return new Text(theme.fg("error", `${icon} ${message}`), 0, 0);
}

/** Options bounding the preview: line cap and optional full-output temp file. */
export interface ToolPreviewOptions {
  previewLines?: number;
  /** Temp file with the full output; shown when truncated. */
  fullOutputPath?: string | undefined;
}

/**
 * The first `previewLines` lines of the first text content part, with a
 * truncation note and the full-output path when the output was parked.
 */
export function toolPreview(
  result: AgentToolResult<unknown>,
  theme: Theme,
  options: ToolPreviewOptions = {},
): Text {
  const previewLines = options.previewLines ?? 15;
  const content = result.content[0];
  const text = content?.type === "text" ? content.text : "";
  const lines = text.split("\n");
  let out = lines.slice(0, previewLines).join("\n");

  if (lines.length > previewLines) {
    out += `\n${theme.fg("muted", `... ${lines.length - previewLines} more lines`)}`;
  }

  if (options.fullOutputPath) {
    out += `\n${theme.fg("muted", `[full output: ${options.fullOutputPath}]`)}`;
  }

  return new Text(out, 0, 0);
}
