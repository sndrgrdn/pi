import { stripVTControlCharacters } from "node:util";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

type RenderCall = NonNullable<ToolDefinition<any, any, any>["renderCall"]>;
type RenderTheme = Parameters<RenderCall>[1];
type RenderContext = Parameters<RenderCall>[2];
type ToolCallSummary = (args: unknown, cwd: string) => string;

const registeredSummaries = new WeakMap<object, ToolCallSummary>();

/** Associate a Trace renderer with the invocation formatter it already uses. */
export function registerToolCallSummary<TArgs>(
	renderCall: object,
	summarize: (args: TArgs, cwd: string) => string,
): void {
	registeredSummaries.set(renderCall, (args, cwd) => summarize(args as TArgs, cwd));
}

const plainTheme = {
	fg: (_color: string, value: string) => value,
	bg: (_color: string, value: string) => value,
	bold: (value: string) => value,
	italic: (value: string) => value,
	underline: (value: string) => value,
	inverse: (value: string) => value,
	strikethrough: (value: string) => value,
} as RenderTheme;

/** Render a tool's concise invocation presentation without result content. */
export function summarizeToolCall(
	tool: ToolDefinition<any, any, any> | undefined,
	name: string,
	args: Record<string, unknown>,
	toolCallId: string,
	cwd: string,
): string {
	if (!tool?.renderCall) return name;
	const registered = registeredSummaries.get(tool.renderCall);
	if (registered) return registered(args, cwd).replace(/\s+/g, " ").trim() || name;
	const context: RenderContext = {
		args,
		toolCallId,
		invalidate: () => {},
		lastComponent: undefined,
		state: {},
		cwd,
		executionStarted: true,
		argsComplete: true,
		isPartial: true,
		expanded: false,
		showImages: false,
		isError: false,
	};
	const summary = stripVTControlCharacters(tool.renderCall(args, plainTheme, context).render(10_000).join(" "))
		.replace(/\s+/g, " ")
		.trim();
	return summary || name;
}
