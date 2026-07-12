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
