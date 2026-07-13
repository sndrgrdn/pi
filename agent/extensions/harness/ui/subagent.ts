import { Text } from "@earendil-works/pi-tui";
import { parseEnvelope } from "../envelopes.ts";

interface RenderContext {
	lastComponent?: unknown;
}
interface RenderTheme {
	fg(color: string, value: string): string;
	bold(value: string): string;
}

export interface SubagentRendererLabels {
	running: string | ((details: SubagentRunningDetails) => string);
	complete: string;
}

export interface SubagentRunningDetails {
	state: "running";
	query?: string;
	mode?: string;
	description?: string;
	actions?: Record<string, number>;
}

export interface SubagentCompleteDetails {
	state: "complete";
}

type SubagentDetails = SubagentRunningDetails | SubagentCompleteDetails;

interface RenderContent {
	type: string;
	text?: string;
}
interface SubagentRenderResult {
	content: readonly RenderContent[];
	details?: unknown;
}

function parseDetails(value: unknown): SubagentDetails | undefined {
	if (typeof value !== "object" || value === null || !("state" in value)) return undefined;
	const state = (value as { state?: unknown }).state;
	if (state === "complete") return { state };
	if (state !== "running") return undefined;
	const raw = value as { query?: unknown; mode?: unknown; description?: unknown; actions?: unknown };
	const query = typeof raw.query === "string" ? raw.query : undefined;
	const mode = typeof raw.mode === "string" ? raw.mode : undefined;
	const description = typeof raw.description === "string" ? raw.description : undefined;
	const actions =
		typeof raw.actions === "object" && raw.actions !== null && !Array.isArray(raw.actions)
			? Object.fromEntries(
					Object.entries(raw.actions).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
				)
			: undefined;
	return { state, query, mode, description, actions };
}

/** One mutable Amp-style row: query/action tally while running, XML title on completion. */
export function createSubagentRenderer(labels: SubagentRendererLabels) {
	return {
		renderCall(_args: { detail?: string } | undefined, _theme: RenderTheme, context: RenderContext): Text {
			const component = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			// Pi renders call and result as separate components. The immediate
			// onUpdate owns the visible running row; keeping the call blank avoids
			// duplicating it above the live result component.
			component.setText("");
			return component;
		},
		renderResult(
			result: SubagentRenderResult,
			options: { expanded: boolean },
			theme: RenderTheme,
			context: RenderContext,
		): Text {
			const component = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const details = parseDetails(result.details);
			if (details?.state === "running") {
				const running = typeof labels.running === "function" ? labels.running(details) : labels.running;
				const detail = details.description ?? details.query;
				const tally = Object.entries(details.actions ?? {})
					.map(([name, count]) => `${name} ×${count}`)
					.join(", ");
				component.setText(
					theme.fg("toolTitle", `◐ ${running}${detail ? ` — ${detail}` : ""}${tally ? ` — ${tally}` : ""}`),
				);
				return component;
			}
			const item = result.content.find((entry) => entry.type === "text");
			const text = item?.type === "text" && typeof item.text === "string" ? item.text : "";
			const envelope = parseEnvelope(text);
			const label = envelope?.tag === "finder_result" ? envelope.title : labels.complete;
			component.setText(
				options.expanded
					? `${theme.fg("success", `✓ ${label}`)}\n${theme.fg("muted", envelope?.content ?? text)}`
					: theme.fg("success", `✓ ${label}`),
			);
			return component;
		},
	};
}
