import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import {
	AuthStorage,
	type CreateAgentSessionOptions,
	createAgentSession,
	getAgentDir,
	ModelRegistry,
	SessionManager,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { AgentDefinition } from "./registry.ts";
import { BackgroundShellRegistry } from "./shell/registry.ts";
import { withShellRegistry } from "./shell/session-registry.ts";

export interface ChildSession {
	sessionID: string;
	processes: BackgroundShellRegistry;
	prompt(message: string): Promise<void>;
	finalMessage(): string;
	abort(): Promise<void>;
	dispose(): void;
	onAction?(listener: (toolName: string) => void): () => void;
	toolLog(): ToolLogEntry[];
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

export interface ChildSessionConfig {
	definition: AgentDefinition;
	cwd: string;
	toolbox?: ChildToolboxFactory;
}

export type ChildSessionFactory = (config: ChildSessionConfig) => Promise<ChildSession>;
export type ChildToolboxFactory = (processes: BackgroundShellRegistry) => ToolDefinition[];

export interface RunOptions<T> {
	definition: AgentDefinition;
	cwd: string;
	input: T;
	mapInput(input: T): string;
	wrapResult(sessionID: string, content: string): string;
	onAction?(toolName: string): void;
	toolbox?: ChildToolboxFactory;
	signal?: AbortSignal;
}

function abortError(): Error {
	const error = new Error("Subagent run aborted");
	error.name = "AbortError";
	return error;
}

function annotateFailure(error: unknown, child: ChildSession | undefined): Error {
	if (!child) return error instanceof Error ? error : new Error(String(error));
	return error instanceof SubagentRunError ? error : new SubagentRunError(child.sessionID, child.toolLog(), error);
}

export class SubagentRunner {
	private readonly createChild: ChildSessionFactory;
	constructor(createChild: ChildSessionFactory = createSdkChildSession) {
		this.createChild = createChild;
	}

	async run<T>(options: RunOptions<T>): Promise<string> {
		if (options.signal?.aborted) throw abortError();
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
				...(options.toolbox ? { toolbox: options.toolbox } : {}),
			});
			if (options.onAction && child.onAction) unsubscribe = child.onAction(options.onAction);
			if (parentAborted) {
				abortPromise ??= child.abort();
				await abortPromise;
				throw annotateFailure(abortError(), child);
			}
			await child.prompt(options.mapInput(options.input));
			if (parentAborted) {
				if (abortPromise) await abortPromise;
				throw annotateFailure(abortError(), child);
			}
			return options.wrapResult(child.sessionID, child.finalMessage());
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

export function resolveConfiguredModel(registry: Pick<ModelRegistry, "find">, model: string): Model<any> {
	const slash = model.indexOf("/");
	if (slash < 1 || slash === model.length - 1) throw new Error(`invalid resolved model "${model}"`);
	const provider = model.slice(0, slash);
	const modelID = model.slice(slash + 1);
	const resolved = registry.find(provider, modelID);
	if (!resolved) throw new Error(`resolved model "${model}" is not configured`);
	return resolved;
}

/** Production adapter: a fresh in-memory pi SDK session, never a fork/resume. */
export async function createSdkChildSession(config: ChildSessionConfig): Promise<ChildSession> {
	const processes = new BackgroundShellRegistry();
	const agentDir = getAgentDir();
	const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
	const modelRegistry = ModelRegistry.create(authStorage, join(agentDir, "models.json"));
	const options: CreateAgentSessionOptions = {
		cwd: config.cwd,
		authStorage,
		modelRegistry,
		model: resolveConfiguredModel(modelRegistry, config.definition.model),
		thinkingLevel: config.definition.reasoningEffort,
		tools: [...config.definition.tools, ...(config.definition.allowMcp ? ["mcp"] : [])],
		customTools: config.toolbox?.(processes) ?? [],
		sessionManager: SessionManager.inMemory(config.cwd),
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
		finalMessage: () => {
			const message = session.getLastAssistantText();
			if (message === undefined) throw new Error(`${config.definition.key} child returned no final message`);
			return message;
		},
		abort: () => session.abort(),
		dispose: () => {
			unsubscribeLog();
			session.dispose();
		},
		toolLog: () => structuredClone(toolLog),
		onAction: (listener) =>
			session.subscribe((event) => {
				if (event.type === "tool_execution_start") listener(event.toolName);
			}),
	};
}
