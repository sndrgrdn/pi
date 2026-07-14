import type { AuthStorage } from "@earendil-works/pi-coding-agent";
import { createHarnessAuthStorage } from "../runner.ts";

export interface ExaDependencies {
	fetch: typeof globalThis.fetch;
	authStorage: Pick<AuthStorage, "get">;
	env: { EXA_API_KEY?: string };
}

type ExaFailureCode =
	| "credentials_missing"
	| "cancelled"
	| "timeout"
	| "authentication"
	| "rate_limit"
	| "upstream"
	| "transport"
	| "malformed_response";

export class CodedToolError<Code extends string> extends Error {
	readonly code: Code;
	constructor(errorName: string, toolName: string, code: Code, message: string) {
		super(`${toolName} ${message}`);
		this.name = errorName;
		this.code = code;
	}
}

export function createCodedToolErrorFactory<Code extends string>(toolName: string, errorName: string) {
	return (code: Code, message: string): CodedToolError<Code> => new CodedToolError(errorName, toolName, code, message);
}

const TIMEOUT_ABORT = Symbol("timeout abort");

export function createExaDependencies(): ExaDependencies {
	return {
		fetch: globalThis.fetch,
		authStorage: createHarnessAuthStorage(),
		env: process.env,
	};
}

function abortFailure(toolName: string, signal: AbortSignal): CodedToolError<ExaFailureCode> {
	const failure = createCodedToolErrorFactory<ExaFailureCode>(toolName, "ExaRequestError");
	return signal.reason === TIMEOUT_ABORT
		? failure("timeout", "timed out after 30 seconds.")
		: failure("cancelled", "was cancelled.");
}

export async function requestExaJson(
	toolName: string,
	endpoint: "search" | "contents",
	body: unknown,
	dependencies: ExaDependencies,
	signal: AbortSignal | undefined,
): Promise<{ ok: true; value: unknown } | { ok: false; error: CodedToolError<ExaFailureCode> }> {
	const failure = createCodedToolErrorFactory<ExaFailureCode>(toolName, "ExaRequestError");
	const credential = dependencies.authStorage.get("exa");
	const apiKey = credential?.type === "api_key" ? credential.key : dependencies.env.EXA_API_KEY;
	if (!apiKey) {
		return {
			ok: false,
			error: failure("credentials_missing", "requires an `exa` API key in Pi AuthStorage or EXA_API_KEY."),
		};
	}
	if (signal?.aborted) return { ok: false, error: failure("cancelled", "was cancelled.") };

	const request = new AbortController();
	const cancel = () => request.abort();
	signal?.addEventListener("abort", cancel, { once: true });
	const timeout = setTimeout(() => request.abort(TIMEOUT_ABORT), 30_000);
	try {
		const response = await dependencies.fetch(`https://api.exa.ai/${endpoint}`, {
			method: "POST",
			headers: { "content-type": "application/json", "x-api-key": apiKey },
			body: JSON.stringify(body),
			signal: request.signal,
		});
		if (request.signal.aborted) return { ok: false, error: abortFailure(toolName, request.signal) };
		if (!response.ok) {
			if (response.status === 401 || response.status === 403)
				return { ok: false, error: failure("authentication", "authentication failed.") };
			if (response.status === 429) return { ok: false, error: failure("rate_limit", "rate limit exceeded.") };
			return {
				ok: false,
				error: failure("upstream", `request failed (HTTP ${response.status}).`),
			};
		}
		try {
			const value = await response.json();
			return request.signal.aborted
				? { ok: false, error: abortFailure(toolName, request.signal) }
				: { ok: true, value };
		} catch {
			return {
				ok: false,
				error: request.signal.aborted
					? abortFailure(toolName, request.signal)
					: failure("malformed_response", "received a malformed response."),
			};
		}
	} catch {
		return {
			ok: false,
			error: request.signal.aborted
				? abortFailure(toolName, request.signal)
				: failure("transport", "network request failed."),
		};
	} finally {
		clearTimeout(timeout);
		signal?.removeEventListener("abort", cancel);
	}
}
