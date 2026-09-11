/** Shared collapsed-result and expanded-preview rendering for tool rows. */

import type { AgentToolResult, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

/** Returns an empty result component. */
export const emptyToolResult = (): Text => new Text("", 0, 0);

/** Renders the first model-facing failure message. */
export function toolErrorResult(
  result: AgentToolResult<unknown>,
  icon: string,
  theme: Theme,
): Text {
  const message = result.content[0]?.type === "text" ? result.content[0].text : "Tool failed";

  return new Text(theme.fg("error", `${icon} ${message}`), 0, 0);
}

/** Limits and full-output metadata for an expanded tool preview. */
export interface ToolPreviewOptions {
  previewLines?: number;
  fullOutputPath?: string | undefined;
}

/** Renders a bounded preview of the first text content part. */
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
