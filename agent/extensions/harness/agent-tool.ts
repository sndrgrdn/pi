/**
 * Agent Tool — the single factory that turns a per-agent spec into a
 * model-visible delegation tool (issue #8). The spine —
 * mode-to-route dispatch, per-call definition build, plan, envelope
 * build/parse, finalize, recovery, Trace View rendering, and the progress
 * signal — lives here; agents are declarative specs.
 */
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { buildEnvelope, type EnvelopeInput, parseEnvelope } from "./envelopes.ts";
import { type AgentKey, type Mode, type ResolvedProfiles, resolveAgentRoute } from "./profiles.ts";
import {
	type AgentDefinition,
	type ChildToolboxFactory,
	isSubagentAbortError,
	SubagentAbortError,
	SubagentRunError,
	type SubagentRunner,
	type SubagentRunResult,
} from "./runner.ts";
import {
	createTraceRenderer,
	emitTraceRunning,
	sanitizeTraceEvidence,
	type TraceInvocation,
	type TraceState,
	withTraceDetails,
} from "./ui/trace.ts";

/** Per-call assembly produced by a spec's `plan` hook. */
export interface AgentToolPlan {
	systemPrompt: string;
	message: string;
	toolbox?: ChildToolboxFactory;
}

/**
 * A spec's reading of the child's final answer. May not be produced (finalize
 * throws). Only finder results carry a title — its envelope variant requires
 * one; every other agent's result cannot express one.
 */
export type AgentToolResult<K extends AgentKey> = {
	content: string;
	traceDetails?: Record<string, unknown>;
} & (K extends "finder" ? { title: string } : { title?: undefined });

/** A spec's recovery from a failed run; the factory wraps it as the error envelope. */
export interface AgentToolRecovery {
	content: string;
	outcome: Extract<TraceState, "failed" | "cancelled">;
}

/** The per-call state a `recover` hook may need to salvage a failed run. */
export interface AgentToolRecoverContext<TParams> {
	params: TParams;
	cwd: string;
	signal: AbortSignal | undefined;
}

export interface AgentToolPresentation<TParams> {
	action: string | ((params: TParams) => string);
	target(params: TParams): string | undefined;
}

export interface AgentToolSpec<TParams, K extends AgentKey> {
	key: K;
	name: string;
	description: string;
	parameters: unknown;
	mode(params: TParams): Mode;
	plan(params: TParams, ctx: { cwd: string }): AgentToolPlan | Promise<AgentToolPlan>;
	finalize(answer: string): AgentToolResult<K>;
	recover?(error: unknown, ctx: AgentToolRecoverContext<TParams>): AgentToolRecovery | Promise<AgentToolRecovery>;
	presentation: AgentToolPresentation<TParams>;
	/** Static per-call facts carried on every details emission (running, success, recover). */
	traceDetails?(params: TParams): Record<string, unknown>;
	tools: readonly string[];
	allowMcp: boolean;
}

type ToolUpdate = (result: { content: { type: "text"; text: string }[]; details: unknown }) => void;

/** Emit the running Trace View state, tallying child tool actions as they happen. */
function createProgressSignal(
	onUpdate: ToolUpdate | undefined,
	traceDetails: Record<string, unknown> | undefined,
): (action: string) => void {
	const actions = new Map<string, number>();
	emitTraceRunning(onUpdate, { ...traceDetails, actions: {} });
	return (action) => {
		actions.set(action, (actions.get(action) ?? 0) + 1);
		emitTraceRunning(onUpdate, { ...traceDetails, actions: Object.fromEntries(actions) });
	};
}

/** Success-envelope construction, keyed by the agent — exhaustive over `AgentKey`. */
const envelopeFor: { [K in AgentKey]: (sessionID: string, result: AgentToolResult<K>) => EnvelopeInput } = {
	finder: (sessionID, result) => ({ kind: "finder", sessionID, title: result.title, content: result.content }),
	librarian: (sessionID, result) => ({ kind: "librarian", sessionID, content: result.content }),
	oracle: (sessionID, result) => ({ kind: "oracle", sessionID, content: result.content }),
	task: (sessionID, result) => ({ kind: "task", sessionID, content: result.content }),
};

interface TraceResultLike {
	content: readonly { type: string; text?: string }[];
	details?: unknown;
}

function progressTallies(details: unknown): string[] {
	if (typeof details !== "object" || details === null) return [];
	const actions = (details as { actions?: Record<string, number> }).actions;
	if (typeof actions !== "object" || actions === null || Array.isArray(actions)) return [];
	const tally = Object.entries(actions)
		.filter((entry): entry is [string, number] => typeof entry[1] === "number")
		.map(([name, count]) => `${name} ×${count}`)
		.join(", ");
	return tally ? [tally] : [];
}

/** Trace View renderer for a delegated agent call: presentation row, tallies, envelope evidence. */
function createAgentToolRenderer<TParams>(presentation: AgentToolPresentation<TParams>) {
	return createTraceRenderer<TParams>({
		invocation(params): TraceInvocation {
			return {
				action: typeof presentation.action === "function" ? presentation.action(params) : presentation.action,
				target: presentation.target(params),
			};
		},
		progress(result: TraceResultLike) {
			return progressTallies(result.details);
		},
		evidence(result: TraceResultLike, theme) {
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

/** The child session a failed run got as far as creating, if any. */
function failureSessionID(error: unknown): string | undefined {
	if (error instanceof SubagentRunError || isSubagentAbortError(error)) return error.sessionID;
	return undefined;
}

/** A finalize throw is a child-run failure: annotate it with the child's session and log. */
function finalizeAnswer<TParams, K extends AgentKey>(
	spec: AgentToolSpec<TParams, K>,
	child: SubagentRunResult,
): AgentToolResult<K> {
	try {
		return spec.finalize(child.answer);
	} catch (error) {
		throw new SubagentRunError(child.sessionID, child.toolLog, error);
	}
}

/** Turn a declarative agent spec into the delegation tool callers register. */
export function createAgentTool<TParams, K extends AgentKey>(
	spec: AgentToolSpec<TParams, K>,
	runner: Pick<SubagentRunner, "run">,
	profiles: ResolvedProfiles,
): ToolDefinition<any, any, any> {
	const renderer = createAgentToolRenderer(spec.presentation);
	return {
		name: spec.name,
		label: spec.name,
		description: spec.description,
		parameters: spec.parameters,
		renderShell: "self",
		async execute(
			_id: string,
			params: TParams,
			signal: AbortSignal | undefined,
			onUpdate: ToolUpdate | undefined,
			ctx: { cwd: string },
		) {
			const traceDetails = spec.traceDetails?.(params);
			const recordAction = createProgressSignal(onUpdate, traceDetails);
			if (signal?.aborted) throw new SubagentAbortError();
			const planned = await spec.plan(params, { cwd: ctx.cwd });
			const route = resolveAgentRoute(profiles, spec.key, spec.mode(params));
			const definition: AgentDefinition = {
				key: spec.key,
				systemPrompt: planned.systemPrompt,
				tools: [...spec.tools],
				allowMcp: spec.allowMcp,
				model: route.model,
				reasoningEffort: route.reasoning,
			};
			try {
				const child = await runner.run({
					definition,
					cwd: ctx.cwd,
					message: planned.message,
					signal,
					onAction: recordAction,
					...(planned.toolbox ? { toolbox: planned.toolbox } : {}),
				});
				const finalized = finalizeAnswer(spec, child);
				return {
					content: [{ type: "text", text: buildEnvelope(envelopeFor[spec.key](child.sessionID, finalized)) }],
					details: withTraceDetails(
						{
							...(finalized.title !== undefined ? { title: finalized.title } : {}),
							...traceDetails,
							...finalized.traceDetails,
						},
						"success",
					),
				};
			} catch (error) {
				if (!spec.recover) throw error;
				const recovery = await spec.recover(error, { params, cwd: ctx.cwd, signal }); // a rethrow here replaces the failure
				const sessionID = failureSessionID(error);
				if (sessionID === undefined) throw error; // no child session — nothing to attribute the report to
				return {
					content: [
						{
							type: "text",
							text: buildEnvelope({ kind: "error", agent: spec.key, sessionID, content: recovery.content }),
						},
					],
					details: withTraceDetails(traceDetails, recovery.outcome),
				};
			}
		},
		renderCall: renderer.renderCall,
		renderResult: renderer.renderResult,
	} as ToolDefinition<any, any, any>;
}
