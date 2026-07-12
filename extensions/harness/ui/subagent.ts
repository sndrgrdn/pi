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

/** One mutable Amp-style row: query/action tally while running, XML title on completion. */
export function createSubagentRenderer(labels: SubagentRendererLabels) {
	return {
		renderCall(args: { detail?: string } | undefined, theme: RenderTheme, context: RenderContext): Text {
			const component = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			component.setText(theme.fg("toolTitle", theme.bold(`${labels.running}${args?.detail ? ` — ${args.detail}` : ""}`)));
			return component;
		},
		renderResult(result: any, options: { expanded: boolean }, theme: RenderTheme, context: RenderContext): Text {
			const component = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const details = result?.details as SubagentRunningDetails | undefined;
			if (details?.state === "running") {
				const tally = Object.entries(details.actions ?? {}).map(([name, count]) => `${name} ×${count}`).join(", ");
				component.setText(theme.fg("toolTitle", `◐ ${labels.running}${details.query ? ` — ${details.query}` : ""}${tally ? ` — ${tally}` : ""}`));
				return component;
			}
			const item = result?.content?.find((entry: { type: string }) => entry.type === "text");
			const text = item?.type === "text" ? item.text : "";
			const envelope = parseEnvelope(text);
			const label = envelope?.title ?? labels.complete;
			component.setText(options.expanded
				? `${theme.fg("success", `✓ ${label}`)}\n${theme.fg("muted", envelope?.content ?? text)}`
				: theme.fg("success", `✓ ${label}`));
			return component;
		},
	};
}
