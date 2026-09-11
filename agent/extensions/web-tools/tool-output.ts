/** Truncate to pi's limits; when truncated, park the full text in a temp file; output is never truncated silently. */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
} from "@earendil-works/pi-coding-agent";

async function writeTempFile(content: string, prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `${prefix}-`));
  const filePath = path.join(dir, "output.txt");
  await writeFile(filePath, content, "utf8");

  return filePath;
}

/** Truncated text plus the temp-file path to the full output, when truncation happened. */
export interface ParkedOutput {
  text: string;
  fullOutputPath?: string;
}

/** Truncate to pi's limits; when truncated, park the full text in a temp file; output is never truncated silently. */
export async function parkTruncatedOutput(content: string, prefix: string): Promise<ParkedOutput> {
  const truncated = truncateHead(content, {
    maxBytes: DEFAULT_MAX_BYTES,
    maxLines: DEFAULT_MAX_LINES,
  });

  if (!truncated.truncated) return { text: truncated.content };
  const fullOutputPath = await writeTempFile(content, prefix);

  const text =
    truncated.content +
    `\n\n[Showing first ${formatSize(truncated.outputBytes)} of ${formatSize(truncated.totalBytes)} (${formatSize(DEFAULT_MAX_BYTES)} limit). Full output: ${fullOutputPath}]`;

  return { text, fullOutputPath };
}
