import { parseEnvelope } from "../envelopes.ts";
import { createTraceRenderer, emitTraceRunning, sanitizeTraceEvidence, type TraceInvocation } from "./trace.ts";

interface SubagentRendererOptions<TArgs> {
	action: string | ((args: TArgs) => string);
	target(args: TArgs): string | undefined;
	qualifiers?(args: TArgs): string[];
}

interface SubagentProgressDetails {
	actions?: Record<string, number>;
}

export function createProgressSignal(
	onUpdate: ((result: { content: { type: "text"; text: string }[]; details: unknown }) => void) | undefined,
	details?: Record<string, unknown>,
): (action: string) => void {
	const actions = new Map<string, number>();
	emitTraceRunning(onUpdate, { ...details, actions: {} });
	return (action) => {
		actions.set(action, (actions.get(action) ?? 0) + 1);
		emitTraceRunning(onUpdate, { ...details, actions: Object.fromEntries(actions) });
	};
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
				action: typeof options.action === "function" ? options.action(args) : options.action,
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
			const content = parseEnvelope(text)?.content;
			return content
				? sanitizeTraceEvidence(content)
						.split("\n")
						.map((line) => theme.fg("toolOutput", line))
						.join("\n")
				: undefined;
		},
	});
}
