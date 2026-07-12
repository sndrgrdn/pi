import { Text } from "@earendil-works/pi-tui";
import { parseEnvelope } from "../envelopes.ts";

interface RenderContext { lastComponent?: unknown }
interface RenderTheme { fg(color: string, value: string): string; bold(value: string): string }

export interface SubagentRendererLabels {
	running: string;
	complete: string;
}

export interface SubagentRunningDetails {
	state: "running";
	query?: string;
	actions?: Record<string, number>;
}

export interface SubagentCompleteDetails {
	state: "complete";
}

type SubagentDetails = SubagentRunningDetails | SubagentCompleteDetails;

interface RenderContent { type: string; text?: string }
interface SubagentRenderResult { content: readonly RenderContent[]; details?: unknown }

function parseDetails(value: unknown): SubagentDetails | undefined {
	if (typeof value !== "object" || value === null || !("state" in value)) return undefined;
	const state = (value as { state?: unknown }).state;
	if (state === "complete") return { state };
	if (state !== "running") return undefined;
	const raw = value as { query?: unknown; actions?: unknown };
	const query = typeof raw.query === "string" ? raw.query : undefined;
	let actions: Record<string, number> | undefined;
	if (typeof raw.actions === "object" && raw.actions !== null && !Array.isArray(raw.actions)) {
		const entries = Object.entries(raw.actions).filter((entry): entry is [string, number] => typeof entry[1] === "number");
		actions = Object.fromEntries(entries);
	}
	return { state, query, actions };
}

/** One mutable Amp-style row: query/action tally while running, XML title on completion. */
export function createSubagentRenderer(labels: SubagentRendererLabels) {
	return {
		renderCall(args: { detail?: string } | undefined, theme: RenderTheme, context: RenderContext): Text {
			const component = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			component.setText(theme.fg("toolTitle", theme.bold(`${labels.running}${args?.detail ? ` — ${args.detail}` : ""}`)));
			return component;
		},
		renderResult(result: SubagentRenderResult, options: { expanded: boolean }, theme: RenderTheme, context: RenderContext): Text {
			const component = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const details = parseDetails(result.details);
			if (details?.state === "running") {
				const tally = Object.entries(details.actions ?? {}).map(([name, count]) => `${name} ×${count}`).join(", ");
				component.setText(theme.fg("toolTitle", `◐ ${labels.running}${details.query ? ` — ${details.query}` : ""}${tally ? ` — ${tally}` : ""}`));
				return component;
			}
			const item = result.content.find((entry) => entry.type === "text");
			const text = item?.type === "text" && typeof item.text === "string" ? item.text : "";
			const envelope = parseEnvelope(text);
			const label = envelope?.tag === "finder_result" ? envelope.title : labels.complete;
			component.setText(options.expanded
				? `${theme.fg("success", `✓ ${label}`)}\n${theme.fg("muted", envelope?.content ?? text)}`
				: theme.fg("success", `✓ ${label}`));
			return component;
		},
	};
}
