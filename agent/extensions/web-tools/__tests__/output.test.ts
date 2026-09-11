import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_MAX_BYTES } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { parkTruncatedOutput } from "../tool-output.ts";

describe("parkTruncatedOutput", () => {
  it("passes short content through untouched", async () => {
    const { text, fullOutputPath } = await parkTruncatedOutput("hello", "pi-test");
    expect(text).toBe("hello");
    expect(fullOutputPath).toBeUndefined();
  });

  it("parks oversized content in a temp file and reports the path", async () => {
    const big = "x".repeat(DEFAULT_MAX_BYTES + 1);
    const { text, fullOutputPath } = await parkTruncatedOutput(big, "pi-test");
    expect(fullOutputPath).toBeDefined();

    if (fullOutputPath === undefined) throw new Error("expected a parked output path");
    expect(text).toContain("[Showing first ");
    expect(text).toContain(`Full output: ${fullOutputPath}`);
    expect(await readFile(fullOutputPath, "utf8")).toBe(big);
    await rm(path.dirname(fullOutputPath), { recursive: true, force: true });
  });
});
