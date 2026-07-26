import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import {
	type CreateAgentSessionOptions,
	createAgentSession,
	getAgentDir,
	ModelRuntime,
	SessionManager,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { AgentKey, ReasoningLevel } from "./profiles.ts";
import { BackgroundShellRegistry } from "./shell/registry.ts";
import { withShellRegistry } from "./shell/session-registry.ts";
import { summarizeToolCall } from "./ui/tool-call.ts";

/** A route-resolved, invocation-ready child agent definition. */
export interface AgentDefinition {
	key: AgentKey;
	systemPrompt: string;
	tools: readonly string[];
	allowMcp: boolean;
	model: string;
	reasoningEffort: ReasoningLevel;
}

export interface ChildSession {
	sessionID: string;
	processes: BackgroundShellRegistry;
	prompt(message: string): Promise<void>;
	finalMessage(): string | undefined;
	abort(): Promise<void>;
	dispose(): void;
	onToolCall?(listener: (toolCall: SubagentToolCall) => void): () => void;
	toolLog(): ToolLogEntry[];
}

export interface SubagentToolCall {
	tool: string;
	summary: string;
}

export interface ToolLogEntry {
	id: string;
	tool: string;
	input: Record<string, unknown>;
	output?: string;
	isError?: boolean;
}

export class SubagentRunError extends Error {
	readonly kind = "child_failure";
	readonly sessionID: string;
	readonly toolLog: ToolLogEntry[];
	constructor(sessionID: string, toolLog: ToolLogEntry[], cause: unknown) {
		super(cause instanceof Error ? cause.message : String(cause), { cause });
		this.name = cause instanceof Error ? cause.name : "SubagentRunError";
		this.sessionID = sessionID;
		this.toolLog = toolLog;
	}
}

export class SubagentAbortError extends Error {
	readonly kind = "cancelled";
	readonly sessionID: string | undefined;
	readonly toolLog: ToolLogEntry[];
	constructor(sessionID?: string, toolLog: ToolLogEntry[] = [], cause: unknown = abortError()) {
		super(cause instanceof Error ? cause.message : String(cause), { cause });
		this.name = "AbortError";
		this.sessionID = sessionID;
		this.toolLog = toolLog;
	}
}

export function isSubagentAbortError(error: unknown): error is SubagentAbortError {
	return error instanceof SubagentAbortError;
}

export interface SubagentRecordConfig {
	parentSession: string;
	name: string;
}

export interface ChildSessionConfig {
	definition: AgentDefinition;
	cwd: string;
	record?: SubagentRecordConfig;
	toolbox?: ChildToolboxFactory;
}

export type ChildSessionFactory = (config: ChildSessionConfig) => Promise<ChildSession>;
export type ChildToolboxFactory = (processes: BackgroundShellRegistry) => ToolDefinition[];

export interface RunOptions {
	definition: AgentDefinition;
	cwd: string;
	message: string;
	record?: SubagentRecordConfig;
	onToolCall?(toolCall: SubagentToolCall): void;
	toolbox?: ChildToolboxFactory;
	signal?: AbortSignal;
	/**
	 * Defaults to required. Set to "optional" only alongside a toolbox whose
	 * terminating submit tool captures the result the final assistant message
	 * would otherwise carry (the agent-tool factory couples the two).
	 */
	finalMessage?: "required" | "optional";
}

/** The completed child run: session attribution, final answer, and tool log. */
export interface SubagentRunResult {
	sessionID: string;
	answer: string;
	toolLog: ToolLogEntry[];
}

function abortError(): Error {
	const error = new Error("Subagent run aborted");
	error.name = "AbortError";
	return error;
}

function annotateFailure(error: unknown, child: ChildSession | undefined): Error {
	if (isSubagentAbortError(error)) return error;
	if (error instanceof Error && error.name === "AbortError")
		return new SubagentAbortError(child?.sessionID, child?.toolLog() ?? [], error);
	if (!child) return error instanceof Error ? error : new Error(String(error));
	return error instanceof SubagentRunError ? error : new SubagentRunError(child.sessionID, child.toolLog(), error);
}

export class SubagentRunner {
	private readonly createChild: ChildSessionFactory;
	constructor(createChild: ChildSessionFactory = createSdkChildSession) {
		this.createChild = createChild;
	}

	async run(options: RunOptions): Promise<SubagentRunResult> {
		if (options.signal?.aborted) throw new SubagentAbortError();
		let parentAborted = false;
		let child: ChildSession | undefined;
		let abortPromise: Promise<void> | undefined;
		let unsubscribe: (() => void) | undefined;
		const onAbort = () => {
			parentAborted = true;
			if (child) abortPromise = child.abort();
		};
		options.signal?.addEventListener("abort", onAbort, { once: true });

		try {
			child = await this.createChild({
				definition: options.definition,
				cwd: options.cwd,
				...(options.record ? { record: options.record } : {}),
				...(options.toolbox ? { toolbox: options.toolbox } : {}),
			});
			if (options.onToolCall && child.onToolCall) unsubscribe = child.onToolCall(options.onToolCall);
			if (parentAborted) {
				abortPromise ??= child.abort();
				await abortPromise;
				throw annotateFailure(abortError(), child);
			}
			await child.prompt(options.message);
			if (parentAborted) {
				if (abortPromise) await abortPromise;
				throw annotateFailure(abortError(), child);
			}
			const answer = child.finalMessage();
			if (answer === undefined && options.finalMessage !== "optional")
				throw new Error(`${options.definition.key} child returned no final message`);
			return { sessionID: child.sessionID, answer: answer ?? "", toolLog: child.toolLog() };
		} catch (error) {
			if (parentAborted) {
				if (abortPromise) await abortPromise;
				throw annotateFailure(abortError(), child);
			}
			throw annotateFailure(error, child);
		} finally {
			unsubscribe?.();
			options.signal?.removeEventListener("abort", onAbort);
			child?.processes.killAll();
			child?.dispose();
		}
	}
}

export function resolveConfiguredModel(runtime: Pick<ModelRuntime, "getModel">, model: string): Model<any> {
	const slash = model.indexOf("/");
	if (slash < 1 || slash === model.length - 1) throw new Error(`invalid resolved model "${model}"`);
	const provider = model.slice(0, slash);
	const modelID = model.slice(slash + 1);
	const resolved = runtime.getModel(provider, modelID);
	if (!resolved) throw new Error(`resolved model "${model}" is not configured`);
	return resolved;
}

/** Build the native session backing a Subagent Record, following caller persistence. */
export function createSubagentSessionManager(
	config: Pick<ChildSessionConfig, "cwd" | "record">,
	agentDir = getAgentDir(),
): SessionManager {
	if (!config.record) return SessionManager.inMemory(config.cwd);
	const sessionManager = SessionManager.create(config.cwd, join(agentDir, "sessions", "subagent"), {
		parentSession: config.record.parentSession,
	});
	sessionManager.appendSessionInfo(config.record.name);
	return sessionManager;
}

/** Production adapter: a fresh pi SDK session, never a fork/resume. */
export async function createSdkChildSession(config: ChildSessionConfig): Promise<ChildSession> {
	const processes = new BackgroundShellRegistry();
	const agentDir = getAgentDir();
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: join(agentDir, "models.json"),
	});
	const options: CreateAgentSessionOptions = {
		cwd: config.cwd,
		agentDir,
		modelRuntime,
		model: resolveConfiguredModel(modelRuntime, config.definition.model),
		thinkingLevel: config.definition.reasoningEffort,
		tools: [...config.definition.tools, ...(config.definition.allowMcp ? ["mcp"] : [])],
		customTools: config.toolbox?.(processes) ?? [],
		sessionManager: createSubagentSessionManager(config, agentDir),
	};
	let session: Awaited<ReturnType<typeof createAgentSession>>["session"];
	try {
		({ session } = await withShellRegistry(processes, () => createAgentSession(options)));
	} catch (error) {
		processes.killAll();
		throw error;
	}
	session.agent.state.systemPrompt = config.definition.systemPrompt;
	const toolLog: ToolLogEntry[] = [];
	const unsubscribeLog = session.subscribe((event) => {
		if (event.type === "tool_execution_start")
			toolLog.push({ id: event.toolCallId, tool: event.toolName, input: event.args });
		if (event.type === "tool_execution_end") {
			const pending = toolLog.find((entry) => entry.id === event.toolCallId);
			if (!pending) throw new Error(`tool log invariant failed: no start event for ${event.toolCallId}`);
			{
				const content = event.result?.content;
				pending.output =
					typeof event.result === "string"
						? event.result
						: Array.isArray(content)
							? content
									.filter((part): part is { type: "text"; text: string } => part.type === "text")
									.map((part) => part.text)
									.join("\n")
							: "";
				pending.isError = event.isError === true;
			}
		}
	});
	return {
		sessionID: session.sessionId,
		processes,
		prompt: (message) => session.agent.prompt(message),
		finalMessage: () => session.getLastAssistantText(),
		abort: () => session.abort(),
		dispose: () => {
			unsubscribeLog();
			session.dispose();
		},
		toolLog: () => structuredClone(toolLog),
		onToolCall: (listener) =>
			session.subscribe((event) => {
				if (event.type === "tool_execution_start") {
					listener({
						tool: event.toolName,
						summary: summarizeToolCall(
							session.getToolDefinition(event.toolName),
							event.toolName,
							event.args,
							event.toolCallId,
							config.cwd,
						),
					});
				}
			}),
	};
}
