import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";

export type TraceState = "running" | "success" | "failed" | "cancelled";

export interface TraceInvocation {
	action: string;
	target?: string;
	qualifiers?: string[];
}

interface TraceDetails {
	trace?: { state?: TraceState; qualifiers?: string[] };
}

/** Merge mechanical Trace View lifecycle facts into existing tool details. */
export function withTraceDetails(details: unknown, state: TraceState, qualifiers?: string[]) {
	const base = typeof details === "object" && details !== null && !Array.isArray(details) ? details : {};
	return { ...base, trace: { state, ...(qualifiers ? { qualifiers } : {}) } };
}

interface TraceResult {
	content: readonly { type: string; text?: string }[];
	details?: unknown;
}

type TraceUpdate = (result: { content: { type: "text"; text: string }[]; details: unknown }) => void;

/** Emit the shared running-state result shape used by every Trace tool. */
export function emitTraceRunning(onUpdate: TraceUpdate | undefined, details?: unknown): void {
	onUpdate?.({ content: [{ type: "text", text: "" }], details: withTraceDetails(details, "running") });
}

export interface TraceToolRegistrar {
	register(tool: ToolDefinition<any, any, any>): void;
}

/** Own the thrown-cancellation bridge required by Pi's public result event. */
export function createTraceToolRegistrar(
	pi: ExtensionAPI,
	isCancellation: (error: unknown, signal: AbortSignal | undefined) => boolean,
): TraceToolRegistrar {
	const toolNames = new Set<string>();
	const cancelledCalls = new Set<string>();
	pi.on("tool_result", (event) => {
		if (!toolNames.has(event.toolName) || !cancelledCalls.delete(event.toolCallId)) return undefined;
		return { details: withTraceDetails(event.details, "cancelled") };
	});
	return {
		register(tool) {
			toolNames.add(tool.name);
			pi.registerTool({
				...tool,
				async execute(toolCallId, params, signal, onUpdate, context) {
					try {
						return await tool.execute(toolCallId, params, signal, onUpdate, context);
					} catch (error) {
						if (isCancellation(error, signal)) cancelledCalls.add(toolCallId);
						throw error;
					}
				},
			});
		},
	};
}

interface TraceTheme {
	fg(color: string, value: string): string;
	bold(value: string): string;
}

interface TraceRenderContext<TArgs> {
	args: TArgs;
	cwd: string;
	isError: boolean;
	lastComponent?: unknown;
}

interface TraceRendererOptions<TArgs> {
	invocation(args: TArgs, cwd: string): TraceInvocation;
	progress?(result: TraceResult): string[];
	evidence?(result: TraceResult, theme: TraceTheme, context: TraceRenderContext<TArgs>): string | undefined;
}

const statePresentation: Record<TraceState, { glyph: string; color: string }> = {
	running: { glyph: "◐", color: "accent" },
	success: { glyph: "✓", color: "success" },
	failed: { glyph: "✗", color: "error" },
	cancelled: { glyph: "■", color: "warning" },
};

function explicitState(details: unknown): TraceState | undefined {
	if (typeof details !== "object" || details === null) return undefined;
	const state = (details as TraceDetails).trace?.state;
	return state && state in statePresentation ? state : undefined;
}

function detailQualifiers(details: unknown): string[] {
	if (typeof details !== "object" || details === null) return [];
	const qualifiers = (details as TraceDetails).trace?.qualifiers;
	return Array.isArray(qualifiers) ? qualifiers.filter((value): value is string => typeof value === "string") : [];
}

function resultText(result: TraceResult): string {
	return result.content
		.filter((item): item is { type: string; text: string } => item.type === "text" && typeof item.text === "string")
		.map((item) => item.text)
		.filter(Boolean)
		.join("\n");
}

/** Match Pi's display boundary: remove terminal controls and unsafe binary characters. */
export function sanitizeTraceEvidence(text: string): string {
	return Array.from(stripVTControlCharacters(text).replace(/\r/g, ""))
		.filter((character) => {
			const code = character.codePointAt(0);
			if (code === undefined) return false;
			if (code === 0x09 || code === 0x0a) return true;
			return code > 0x1f && !(code >= 0xfff9 && code <= 0xfffb);
		})
		.join("");
}

class TraceText extends Text {
	private row = "";
	private evidence = "";

	setTrace(row: string, evidence: string): void {
		this.row = row;
		this.evidence = evidence;
		this.invalidate();
	}

	override render(width: number): string[] {
		if (!this.row) return [];
		const row = truncateToWidth(this.row, width, "", true);
		if (!this.evidence) return [row];
		return [row, ...new Text(this.evidence, 0, 0).render(width)];
	}
}

/** Shared public-contract renderer for one-row Trace View entries. */
export function createTraceRenderer<TArgs>(options: TraceRendererOptions<TArgs>) {
	return {
		renderCall(_args: TArgs, _theme: TraceTheme, context: { lastComponent?: unknown }): TraceText {
			const component = (context.lastComponent as TraceText | undefined) ?? new TraceText("", 0, 0);
			component.setTrace("", "");
			return component;
		},
		renderResult(
			result: TraceResult,
			renderOptions: { expanded: boolean; isPartial: boolean },
			theme: TraceTheme,
			context: TraceRenderContext<TArgs>,
		): TraceText {
			const component = (context.lastComponent as TraceText | undefined) ?? new TraceText("", 0, 0);
			const state =
				explicitState(result.details) ??
				(renderOptions.isPartial ? "running" : context.isError ? "failed" : "success");
			const presentation = statePresentation[state];
			const invocation = options.invocation(context.args, context.cwd);
			const target = invocation.target ? ` ${invocation.target}` : "";
			const progress = state === "running" ? (options.progress?.(result) ?? []) : [];
			const qualifiers = [...(invocation.qualifiers ?? []), ...detailQualifiers(result.details), ...progress]
				.map((value) => ` · ${theme.fg("muted", value)}`)
				.join("");
			const row = `${theme.fg(presentation.color, presentation.glyph)} ${theme.bold(invocation.action)}${target}${qualifiers}`;
			const customEvidence = renderOptions.expanded ? options.evidence?.(result, theme, context) : undefined;
			const safeResultText = sanitizeTraceEvidence(resultText(result));
			const evidence = !renderOptions.expanded
				? ""
				: (customEvidence ??
					safeResultText
						.split("\n")
						.map((line) => theme.fg("toolOutput", line))
						.join("\n"));
			component.setTrace(row, evidence);
			return component;
		},
	};
}

function isInside(base: string, target: string): boolean {
	const path = relative(base, target);
	return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

/** Apply Trace View's cwd/home/absolute path policy. */
export function formatTracePath(path: string, cwd: string, home = homedir()): string {
	const absolute = isAbsolute(path) ? resolve(path) : resolve(cwd, path);
	if (isInside(cwd, absolute)) {
		const local = relative(cwd, absolute);
		return local ? `./${local}` : "./";
	}
	if (isInside(home, absolute)) {
		const local = relative(home, absolute);
		return local ? `~/${local}` : "~";
	}
	return absolute;
}

export interface ShellTraceArgs {
	command: string;
	workdir?: string;
}

/** Mechanically format a shell invocation without parsing shell grammar or output. */
export function shellTraceInvocation(args: ShellTraceArgs, cwd: string): TraceInvocation {
	const firstLine = args.command
		.split("\n")
		.find((line) => line.trim().length > 0)
		?.trim();
	const target = `${firstLine ?? ""}${args.command.includes("\n") ? " …" : ""}`;
	const workdir = args.workdir ? resolve(cwd, args.workdir) : cwd;
	return {
		action: "$",
		target,
		qualifiers: workdir === resolve(cwd) ? [] : [`in ${formatTracePath(workdir, cwd)}`],
	};
}
