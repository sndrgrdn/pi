import { parseEnvelope } from "../envelopes.ts";
import { createTraceRenderer, type TraceInvocation } from "./trace.ts";

interface SubagentRendererOptions<TArgs> {
	action: string;
	target(args: TArgs): string | undefined;
	qualifiers?(args: TArgs): string[];
}

interface SubagentProgressDetails {
	actions?: Record<string, number>;
}

function progressTallies(details: unknown): string[] {
	if (typeof details !== "object" || details === null) return [];
	const actions = (details as SubagentProgressDetails).actions;
	if (typeof actions !== "object" || actions === null || Array.isArray(actions)) return [];
	const tally = Object.entries(actions)
		.filter((entry): entry is [string, number] => typeof entry[1] === "number")
		.map(([name, count]) => `${name} ×${count}`)
		.join(", ");
	return tally ? [tally] : [];
}

/** Shared Trace View renderer for delegated agent calls. */
export function createSubagentRenderer<TArgs>(options: SubagentRendererOptions<TArgs>) {
	return createTraceRenderer<TArgs>({
		invocation(args): TraceInvocation {
			return {
				action: options.action,
				target: options.target(args),
				qualifiers: options.qualifiers?.(args),
			};
		},
		progress(result) {
			return progressTallies(result.details);
		},
		evidence(result, theme) {
			const text = result.content
				.filter(
					(item): item is { type: string; text: string } => item.type === "text" && typeof item.text === "string",
				)
				.map((item) => item.text)
				.join("\n");
			return parseEnvelope(text)
				?.content.split("\n")
				.map((line) => theme.fg("toolOutput", line))
				.join("\n");
		},
	});
}
