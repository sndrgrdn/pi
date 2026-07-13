/**
 * Output formatting shared by the shell triplet (spec §4.1–§4.3): pi-style
 * truncation with the temp-file footer, status-line suffixing, and the
 * 100ms TUI streaming throttle.
 */
import type { TruncationResult } from "@earendil-works/pi-coding-agent";
import { createBashToolDefinition, DEFAULT_MAX_BYTES, truncateTail } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

/**
 * Pi's builtin bash tool definition, shared by the triplet for TUI
 * delegation: `shell_command` uses its renderCall/renderResult verbatim;
 * status/cancel hand-build their id-prefixed titles (pi's formatBashCall
 * hardcodes the `$` prefix) but delegate renderResult.
 */
export const bashToolBase = createBashToolDefinition(process.cwd());

/** Render a hand-built tool title row, reusing the previous Text component. */
export function renderToolTitle(title: string, theme: any, context: any): Text {
	const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
	text.setText(theme.fg("toolTitle", theme.bold(title)));
	return text;
}

/** Pi bash parity: throttle streaming TUI updates to 100ms. */
export const UPDATE_THROTTLE_MS = 100;

export interface FormattedOutput {
	text: string;
	details?: { truncation: TruncationResult; fullOutputPath: string };
}

/** Bound raw output pi-style and append the truncation footer. */
export function formatShellOutput(raw: string, fullOutputPath: string): FormattedOutput {
	const truncation = truncateTail(raw.trimEnd());
	if (!truncation.truncated) {
		return { text: truncation.content };
	}
	const startLine = truncation.totalLines - truncation.outputLines + 1;
	const endLine = truncation.totalLines;
	const limit = truncation.truncatedBy === "bytes" ? ` (${Math.round(DEFAULT_MAX_BYTES / 1024)}KB limit)` : "";
	const footer = `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}${limit}. Full output: ${fullOutputPath}]`;
	return { text: truncation.content + footer, details: { truncation, fullOutputPath } };
}

/** Append a status line (e.g. `exited 0`) after the output block. */
export function appendStatus(text: string, status: string): string {
	return `${text ? `${text}\n\n` : ""}${status}`;
}
