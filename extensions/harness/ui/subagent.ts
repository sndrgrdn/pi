import { Text } from "@earendil-works/pi-tui";

export interface SubagentRow {
	state: "running" | "complete";
	label: string;
	detail?: string;
	transcript?: string;
}

/** Amp-style one-row status with an expandable child transcript (§3.5). */
export function renderSubagentRow(row: SubagentRow, expanded = false): string[] {
	const marker = row.state === "running" ? "◐" : "✓";
	const detail = row.detail ? ` — ${row.detail}` : "";
	const lines = [`${marker} ${row.label}${detail}`];
	if (expanded && row.transcript) {
		lines.push(...row.transcript.split("\n").map((line) => `  ${line}`));
	}
	return lines;
}

function decodeXml(value: string): string {
	return value.replaceAll("&quot;", '"').replaceAll("&gt;", ">").replaceAll("&lt;", "<").replaceAll("&amp;", "&");
}

export interface ParsedSubagentEnvelope {
	tag: string;
	title?: string;
	sessionID: string;
	content: string;
}

export function parseSubagentEnvelope(value: string): ParsedSubagentEnvelope | undefined {
	const match = value.match(/^<([a-z_]+)([^>]*)>\n?([\s\S]*?)\n?<\/\1>$/);
	if (!match?.[1] || match[2] === undefined || match[3] === undefined) return undefined;
	const attribute = (name: string) => match[2]?.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1];
	const sessionID = attribute("sessionID");
	if (sessionID === undefined) return undefined;
	const title = attribute("title");
	return { tag: match[1], title: title === undefined ? undefined : decodeXml(title), sessionID: decodeXml(sessionID), content: match[3].trim() };
}

interface RenderContext { lastComponent?: unknown }
interface RenderTheme { fg(color: string, value: string): string; bold(value: string): string }

export function renderSubagentCall(row: { label: string; detail?: string }, theme: RenderTheme, context: RenderContext): Text {
	const component = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
	component.setText(theme.fg("toolTitle", theme.bold(`${row.label}${row.detail ? ` — ${row.detail}` : ""}`)));
	return component;
}

export function renderSubagentResult(input: {
	result: any;
	options: { expanded: boolean };
	theme: RenderTheme;
	context: RenderContext;
	labels: { running: string; complete: string };
}): Text {
	const component = (input.context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
	const details = input.result?.details as { state?: string; query?: string; actions?: Record<string, number> } | undefined;
	if (details?.state === "running") {
		const tally = Object.entries(details.actions ?? {}).map(([name, count]) => `${name} ×${count}`).join(", ");
		component.setText(input.theme.fg("toolTitle", `◐ ${input.labels.running}${details.query ? ` — ${details.query}` : ""}${tally ? ` — ${tally}` : ""}`));
		return component;
	}
	const item = input.result?.content?.find((entry: { type: string }) => entry.type === "text");
	const text = item?.type === "text" ? item.text : "";
	const envelope = parseSubagentEnvelope(text);
	const label = envelope?.title ?? input.labels.complete;
	component.setText(input.options.expanded
		? `${input.theme.fg("success", `✓ ${label}`)}\n${input.theme.fg("muted", envelope?.content ?? text)}`
		: input.theme.fg("success", `✓ ${label}`));
	return component;
}
