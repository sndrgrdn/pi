import type { Model } from "@earendil-works/pi-ai";
import {
	AuthStorage,
	createAgentSession,
	getAgentDir,
	ModelRegistry,
	SessionManager,
	type CreateAgentSessionOptions,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import type { AgentDefinition } from "./registry.ts";
import { BackgroundShellRegistry } from "./shell/registry.ts";
import { withShellRegistry } from "./shell/session-registry.ts";
import { createShellCommandTool } from "./shell/command.ts";
import { createShellStatusTool } from "./shell/status.ts";
import { createShellCancelTool } from "./shell/cancel.ts";
import { createCheckoutTool } from "./tools/checkout.ts";

export interface ChildSession {
	sessionID: string;
	processes: BackgroundShellRegistry;
	prompt(message: string): Promise<void>;
	finalMessage(): string;
	abort(): Promise<void>;
	dispose(): void;
	onAction?(listener: (toolName: string) => void): () => void;
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

export class SubagentRunner {
	constructor(private readonly createChild: ChildSessionFactory = createSdkChildSession) {}

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
				throw abortError();
			}
			await child.prompt(options.mapInput(options.input));
			if (parentAborted) {
				if (abortPromise) await abortPromise;
				throw abortError();
			}
			return options.wrapResult(child.sessionID, child.finalMessage());
		} catch (error) {
			if (parentAborted) {
				if (abortPromise) await abortPromise;
				throw abortError();
			}
			throw error;
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
	const shellTools = [
		createShellCommandTool(processes),
		createShellStatusTool(processes),
		createShellCancelTool(processes),
	];
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
		customTools: [
			...(config.toolbox?.(processes) ?? []),
			...(config.definition.key === "librarian" ? [createCheckoutTool(), ...shellTools] : []),
		],
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
		dispose: () => session.dispose(),
		onAction: (listener) => session.subscribe((event) => {
			if (event.type === "tool_execution_start") listener(event.toolName);
		}),
	};
}
