import { getModel, type Model } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	SessionManager,
	type CreateAgentSessionOptions,
} from "@earendil-works/pi-coding-agent";
import { buildEnvelope } from "./envelopes.ts";
import type { AgentDefinition } from "./registry.ts";
import { BackgroundShellRegistry } from "./shell/registry.ts";
import { withShellRegistry } from "./shell/session-registry.ts";

export interface ChildProcesses {
	killAll(): void;
}

export interface ChildSession {
	sessionID: string;
	prompt(message: string): Promise<void>;
	finalMessage(): string | undefined;
	abort(): Promise<void>;
	dispose(): void;
}

export interface ChildSessionConfig {
	definition: AgentDefinition;
	cwd: string;
	processes: ChildProcesses;
}

export type ChildSessionFactory = (config: ChildSessionConfig) => Promise<ChildSession>;

export interface RunOptions<T> {
	definition: AgentDefinition;
	cwd: string;
	input: T;
	mapInput(input: T): string;
	signal?: AbortSignal;
}

function abortError(): Error {
	const error = new Error("Subagent run aborted");
	error.name = "AbortError";
	return error;
}

export class SubagentRunner {
	constructor(
		private readonly createChild: ChildSessionFactory = createSdkChildSession,
		private readonly createProcesses: () => ChildProcesses = () => new BackgroundShellRegistry(),
	) {}

	async run<T>(options: RunOptions<T>): Promise<string> {
		if (options.signal?.aborted) throw abortError();
		const processes = this.createProcesses();
		let parentAborted = false;
		let child: ChildSession | undefined;
		const onAbort = () => {
			parentAborted = true;
			if (child) void child.abort();
		};
		options.signal?.addEventListener("abort", onAbort, { once: true });

		try {
			child = await this.createChild({ definition: options.definition, cwd: options.cwd, processes });
			if (parentAborted) {
				await child.abort();
				throw abortError();
			}
			await child.prompt(options.mapInput(options.input));
			if (parentAborted) throw abortError();
			const message = child.finalMessage();
			if (message === undefined) throw new Error(`${options.definition.key} child returned no final message`);
			return buildEnvelope(options.definition.key, child.sessionID, message);
		} catch (error) {
			if (parentAborted) throw abortError();
			throw error;
		} finally {
			options.signal?.removeEventListener("abort", onAbort);
			processes.killAll();
			child?.dispose();
		}
	}
}

/** Production adapter: a fresh in-memory pi SDK session, never a fork/resume. */
export async function createSdkChildSession(config: ChildSessionConfig): Promise<ChildSession> {
	const slash = config.definition.model.indexOf("/");
	if (slash < 1) throw new Error(`invalid resolved model "${config.definition.model}"`);
	const provider = config.definition.model.slice(0, slash);
	const modelID = config.definition.model.slice(slash + 1);
	const resolveModel = getModel as unknown as (provider: string, modelID: string) => Model<any>;
	const options: CreateAgentSessionOptions = {
		cwd: config.cwd,
		model: resolveModel(provider, modelID),
		thinkingLevel: config.definition.reasoningEffort,
		tools: [...config.definition.tools, ...(config.definition.allowMcp ? ["mcp"] : [])],
		sessionManager: SessionManager.inMemory(config.cwd),
	};
	const { session } = await withShellRegistry(config.processes as BackgroundShellRegistry, () => createAgentSession(options));
	session.agent.state.systemPrompt = config.definition.systemPrompt;
	return {
		sessionID: session.sessionId,
		prompt: (message) => session.agent.prompt(message),
		finalMessage: () => session.getLastAssistantText(),
		abort: () => session.abort(),
		dispose: () => session.dispose(),
	};
}
