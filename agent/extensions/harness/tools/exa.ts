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

class ExaRequestError extends Error {
	readonly code: ExaFailureCode;
	constructor(toolName: string, code: ExaFailureCode, message: string) {
		super(`${toolName} ${message}`);
		this.name = "ExaRequestError";
		this.code = code;
	}
}

const TIMEOUT_ABORT = Symbol("timeout abort");

export function createExaDependencies(): ExaDependencies {
	return {
		fetch: globalThis.fetch,
		authStorage: createHarnessAuthStorage(),
		env: process.env,
	};
}

function requestFailure(toolName: string, code: ExaFailureCode, message: string): ExaRequestError {
	return new ExaRequestError(toolName, code, message);
}

function abortFailure(toolName: string, signal: AbortSignal): ExaRequestError {
	return signal.reason === TIMEOUT_ABORT
		? requestFailure(toolName, "timeout", "timed out after 30 seconds.")
		: requestFailure(toolName, "cancelled", "was cancelled.");
}

export async function requestExaJson(
	toolName: string,
	endpoint: "search" | "contents",
	body: unknown,
	dependencies: ExaDependencies,
	signal: AbortSignal | undefined,
): Promise<{ ok: true; value: unknown } | { ok: false; error: ExaRequestError }> {
	const credential = dependencies.authStorage.get("exa");
	const apiKey = credential?.type === "api_key" ? credential.key : dependencies.env.EXA_API_KEY;
	if (!apiKey) {
		return {
			ok: false,
			error: requestFailure(
				toolName,
				"credentials_missing",
				"requires an `exa` API key in Pi AuthStorage or EXA_API_KEY.",
			),
		};
	}
	if (signal?.aborted) return { ok: false, error: requestFailure(toolName, "cancelled", "was cancelled.") };

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
		if (!response.ok) {
			if (response.status === 401 || response.status === 403)
				return { ok: false, error: requestFailure(toolName, "authentication", "authentication failed.") };
			if (response.status === 429)
				return { ok: false, error: requestFailure(toolName, "rate_limit", "rate limit exceeded.") };
			return {
				ok: false,
				error: requestFailure(toolName, "upstream", `request failed (HTTP ${response.status}).`),
			};
		}
		try {
			return { ok: true, value: await response.json() };
		} catch {
			return { ok: false, error: requestFailure(toolName, "malformed_response", "received a malformed response.") };
		}
	} catch {
		return {
			ok: false,
			error: request.signal.aborted
				? abortFailure(toolName, request.signal)
				: requestFailure(toolName, "transport", "network request failed."),
		};
	} finally {
		clearTimeout(timeout);
		signal?.removeEventListener("abort", cancel);
	}
}
