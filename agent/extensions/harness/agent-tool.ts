/**
 * Agent Tool — the single factory that turns a per-agent spec into a
 * model-visible delegation tool (issue #8, expand phase #9). The spine —
 * mode-to-route dispatch, per-call definition build, plan, envelope
 * build/parse, finalize, recovery, Trace View rendering, and the progress
 * signal — lives here; agents are declarative specs.
 */
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { buildEnvelope, type EnvelopeInput, parseEnvelope } from "./envelopes.ts";
import { type AgentKey, type Mode, type ResolvedProfiles, resolveAgentRoute } from "./profiles.ts";
import { resolveAgentDefinition } from "./registry.ts";
import { type ChildToolboxFactory, isSubagentAbortError, SubagentRunError, type SubagentRunner } from "./runner.ts";
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

/** A spec's reading of the child's final answer. May not be produced (finalize throws). */
export interface AgentToolResult {
	content: string;
	title?: string;
	traceDetails?: Record<string, unknown>;
}

/** A spec's recovery from a failed run; the factory wraps it as the error envelope. */
export interface AgentToolRecovery {
	content: string;
	outcome: Extract<TraceState, "failed" | "cancelled">;
}

export interface AgentToolPresentation<TParams> {
	action: string | ((params: TParams) => string);
	target(params: TParams): string | undefined;
	qualifiers?(params: TParams): string[];
}

export interface AgentToolSpec<TParams> {
	key: AgentKey;
	name: string;
	description: string;
	parameters: unknown;
	mode(params: TParams): Mode;
	plan(params: TParams, ctx: { cwd: string }): AgentToolPlan | Promise<AgentToolPlan>;
	finalize(answer: string): AgentToolResult;
	recover?(error: unknown): AgentToolRecovery | Promise<AgentToolRecovery>;
	presentation: AgentToolPresentation<TParams>;
	tools: readonly string[];
	allowMcp: boolean;
}

type ToolUpdate = (result: { content: { type: "text"; text: string }[]; details: unknown }) => void;

/** Emit the running Trace View state, tallying child tool actions as they happen. */
function createProgressSignal(onUpdate: ToolUpdate | undefined): (action: string) => void {
	const actions = new Map<string, number>();
	emitTraceRunning(onUpdate, { actions: {} });
	return (action) => {
		actions.set(action, (actions.get(action) ?? 0) + 1);
		emitTraceRunning(onUpdate, { actions: Object.fromEntries(actions) });
	};
}

function envelopeInput(key: AgentKey, sessionID: string, result: AgentToolResult): EnvelopeInput {
	return key === "finder"
		? { kind: "finder", sessionID, title: result.title ?? "", content: result.content }
		: { kind: key, sessionID, content: result.content };
}

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
				qualifiers: presentation.qualifiers?.(params),
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

/** Turn a declarative agent spec into the delegation tool callers register. */
export function createAgentTool<TParams>(
	spec: AgentToolSpec<TParams>,
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
			const recordAction = createProgressSignal(onUpdate);
			const planned = await spec.plan(params, { cwd: ctx.cwd });
			const definition = resolveAgentDefinition(
				{ key: spec.key, systemPrompt: planned.systemPrompt, tools: spec.tools, allowMcp: spec.allowMcp },
				resolveAgentRoute(profiles, spec.key, spec.mode(params)),
			);
			try {
				let child: { sessionID: string; answer: string } | undefined;
				await runner.run({
					definition,
					cwd: ctx.cwd,
					input: params,
					signal,
					onAction: recordAction,
					...(planned.toolbox ? { toolbox: planned.toolbox } : {}),
					mapInput: () => planned.message,
					wrapResult: (sessionID, answer) => {
						child = { sessionID, answer };
						return answer;
					},
				});
				if (child === undefined) throw new Error(`${spec.key} runner completed without a child result`);
				const finalized = spec.finalize(child.answer);
				return {
					content: [{ type: "text", text: buildEnvelope(envelopeInput(spec.key, child.sessionID, finalized)) }],
					details: withTraceDetails(
						{ ...(finalized.title !== undefined ? { title: finalized.title } : {}), ...finalized.traceDetails },
						"success",
					),
				};
			} catch (error) {
				if (!spec.recover) throw error;
				const recovery = await spec.recover(error); // a rethrow here replaces the failure
				const sessionID = failureSessionID(error);
				if (sessionID === undefined) throw error; // no child session — nothing to attribute the report to
				return {
					content: [
						{ type: "text", text: buildEnvelope({ kind: "task_error", sessionID, content: recovery.content }) },
					],
					details: withTraceDetails(undefined, recovery.outcome),
				};
			}
		},
		renderCall: renderer.renderCall,
		renderResult: renderer.renderResult,
	} as ToolDefinition<any, any, any>;
}
