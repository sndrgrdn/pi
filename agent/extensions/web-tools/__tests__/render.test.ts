import type { AgentToolResult, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { emptyToolResult, toolErrorResult, toolPreview } from "../../utils/tool-render.ts";

// SAFETY: These tests access only Theme.fg.
const theme = { fg: (_color: string, text: string) => text } as Theme;

const rendered = (component: Text) =>
  component
    .render(200)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .join("\n");

describe("tool result rendering (opencode-style)", () => {
  it("collapses a completed result to nothing: opencode keeps only the start line", () => {
    expect(rendered(emptyToolResult())).toBe("");
  });

  it("shows the failure message on errors", () => {
    const result: AgentToolResult<unknown> = {
      content: [{ type: "text", text: "Request timed out" }],
      details: {},
    };

    expect(rendered(toolErrorResult(result, "%", theme))).toBe("% Request timed out");
  });

  it("previews the result text capped at previewLines", () => {
    const result: AgentToolResult<unknown> = {
      content: [{ type: "text", text: "line1\nline2\nline3\nline4" }],
      details: {},
    };

    const preview = toolPreview(result, theme, { previewLines: 2 });
    expect(rendered(preview)).toBe("line1\nline2\n... 2 more lines");
  });

  it("appends the temp file path when the output was truncated", () => {
    const result: AgentToolResult<unknown> = {
      content: [{ type: "text", text: "body" }],
      details: {},
    };

    const path = "/tmp/pi-webfetch-abc123/output.txt";
    expect(rendered(toolPreview(result, theme, { fullOutputPath: path }))).toBe(
      `body\n[full output: ${path}]`,
    );
  });
});
