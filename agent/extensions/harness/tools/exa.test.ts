import { describe, expect, it, vi } from "vitest";
import { createCodedToolErrorFactory, type ExaDependencies, requestExaJson } from "./exa.ts";

const TOOL_NAME = "web_search";
const BODY = { query: "Rails" };

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function dependencies(
	fetch: typeof globalThis.fetch,
	options: {
		getCredential?: ExaDependencies["getCredential"];
		env?: ExaDependencies["env"];
	} = {},
): ExaDependencies {
	return {
		fetch,
		getCredential: options.getCredential ?? (() => ({ type: "api_key", key: "stored-secret" })),
		env: options.env ?? {},
	};
}

function abortableFetch() {
	return vi.fn(
		async (_url: string | URL | Request, init?: RequestInit) =>
			new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
			}),
	);
}

function responseWithAbortableJson() {
	let bodyStarted!: () => void;
	const started = new Promise<void>((resolve) => {
		bodyStarted = resolve;
	});
	const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
		return {
			ok: true,
			status: 200,
			json: async () => {
				bodyStarted();
				return new Promise<unknown>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
				});
			},
		} as Response;
	});
	return { fetch, started };
}

describe("Exa transport", () => {
	it("creates prefixed coded tool errors for transport consumers", () => {
		const failure = createCodedToolErrorFactory<"invalid_input">("web_search", "WebSearchError");

		expect(failure("invalid_input", "requires a query.")).toMatchObject({
			name: "WebSearchError",
			code: "invalid_input",
			message: "web_search requires a query.",
		});
	});

	it("prefers the stored API key over EXA_API_KEY", async () => {
		const fetch = vi.fn(async () => jsonResponse({ results: [] }));
		const getCredential = vi.fn(() => ({ type: "api_key" as const, key: "stored-secret" }));

		const outcome = await requestExaJson(
			TOOL_NAME,
			"search",
			BODY,
			dependencies(fetch as typeof globalThis.fetch, {
				getCredential,
				env: { EXA_API_KEY: "environment-secret" },
			}),
			undefined,
		);

		expect(outcome).toEqual({ ok: true, value: { results: [] } });
		expect(getCredential).toHaveBeenCalledOnce();
		expect(fetch).toHaveBeenCalledOnce();
		expect(fetch).toHaveBeenCalledWith(
			"https://api.exa.ai/search",
			expect.objectContaining({
				headers: { "content-type": "application/json", "x-api-key": "stored-secret" },
				body: JSON.stringify(BODY),
			}),
		);
	});

	it("falls back to EXA_API_KEY when auth.json has no API key", async () => {
		const fetch = vi.fn(async () => jsonResponse({ results: [] }));

		await requestExaJson(
			TOOL_NAME,
			"search",
			BODY,
			dependencies(fetch as typeof globalThis.fetch, {
				getCredential: () => ({ type: "oauth" }) as any,
				env: { EXA_API_KEY: "environment-secret" },
			}),
			undefined,
		);

		expect(fetch).toHaveBeenCalledWith(
			"https://api.exa.ai/search",
			expect.objectContaining({
				headers: { "content-type": "application/json", "x-api-key": "environment-secret" },
			}),
		);
	});

	it("reports missing credentials before making a request", async () => {
		const fetch = vi.fn();

		const outcome = await requestExaJson(
			TOOL_NAME,
			"search",
			BODY,
			dependencies(fetch as typeof globalThis.fetch, { getCredential: () => undefined }),
			undefined,
		);

		expect(outcome).toMatchObject({
			ok: false,
			error: {
				code: "credentials_missing",
				message: "web_search requires an `exa` API key in Pi auth.json or EXA_API_KEY.",
			},
		});
		expect(fetch).not.toHaveBeenCalled();
	});

	it.each([
		[401, "authentication", "authentication failed"],
		[403, "authentication", "authentication failed"],
		[429, "rate_limit", "rate limit exceeded"],
		[500, "upstream", "request failed (HTTP 500)"],
	] as const)("maps HTTP %i responses to %s failures", async (status, code, message) => {
		const fetch = vi.fn(async () => jsonResponse({ error: "provider-secret" }, status));

		const outcome = await requestExaJson(
			TOOL_NAME,
			"search",
			BODY,
			dependencies(fetch as typeof globalThis.fetch),
			undefined,
		);

		expect(outcome).toMatchObject({ ok: false, error: { code, message: expect.stringContaining(message) } });
		expect(JSON.stringify(outcome)).not.toContain("provider-secret");
		expect(fetch).toHaveBeenCalledOnce();
	});

	it("maps rejected requests to a transport failure", async () => {
		const fetch = vi.fn(async () => Promise.reject(new Error("socket stored-secret")));

		const outcome = await requestExaJson(
			TOOL_NAME,
			"search",
			BODY,
			dependencies(fetch as typeof globalThis.fetch),
			undefined,
		);

		expect(outcome).toMatchObject({
			ok: false,
			error: { code: "transport", message: "web_search network request failed." },
		});
		expect(JSON.stringify(outcome)).not.toContain("stored-secret");
		expect(fetch).toHaveBeenCalledOnce();
	});

	it("maps malformed JSON to a malformed-response failure", async () => {
		const fetch = vi.fn(async () => new Response("not json"));

		const outcome = await requestExaJson(
			TOOL_NAME,
			"search",
			BODY,
			dependencies(fetch as typeof globalThis.fetch),
			undefined,
		);

		expect(outcome).toMatchObject({
			ok: false,
			error: { code: "malformed_response", message: "web_search received a malformed response." },
		});
		expect(fetch).toHaveBeenCalledOnce();
	});

	it("times out an in-flight request without retrying", async () => {
		vi.useFakeTimers();
		try {
			const fetch = abortableFetch();
			const pending = requestExaJson(
				TOOL_NAME,
				"search",
				BODY,
				dependencies(fetch as typeof globalThis.fetch),
				undefined,
			);

			await vi.advanceTimersByTimeAsync(30_000);

			await expect(pending).resolves.toMatchObject({
				ok: false,
				error: { code: "timeout", message: "web_search timed out after 30 seconds." },
			});
			expect(fetch).toHaveBeenCalledOnce();
		} finally {
			vi.useRealTimers();
		}
	});

	it("honors parent cancellation without retrying", async () => {
		const fetch = abortableFetch();
		const parent = new AbortController();
		const pending = requestExaJson(
			TOOL_NAME,
			"search",
			BODY,
			dependencies(fetch as typeof globalThis.fetch),
			parent.signal,
		);

		parent.abort();

		await expect(pending).resolves.toMatchObject({
			ok: false,
			error: { code: "cancelled", message: "web_search was cancelled." },
		});
		expect(fetch).toHaveBeenCalledOnce();
	});

	it("classifies cancellation during response JSON consumption as cancelled", async () => {
		const { fetch, started } = responseWithAbortableJson();
		const parent = new AbortController();
		const pending = requestExaJson(
			TOOL_NAME,
			"search",
			BODY,
			dependencies(fetch as typeof globalThis.fetch),
			parent.signal,
		);
		await started;

		parent.abort();

		await expect(pending).resolves.toMatchObject({
			ok: false,
			error: { code: "cancelled", message: "web_search was cancelled." },
		});
		expect(fetch).toHaveBeenCalledOnce();
	});

	it("classifies timeout during response JSON consumption as timeout", async () => {
		vi.useFakeTimers();
		try {
			const { fetch, started } = responseWithAbortableJson();
			const pending = requestExaJson(
				TOOL_NAME,
				"search",
				BODY,
				dependencies(fetch as typeof globalThis.fetch),
				undefined,
			);
			await started;

			await vi.advanceTimersByTimeAsync(30_000);

			await expect(pending).resolves.toMatchObject({
				ok: false,
				error: { code: "timeout", message: "web_search timed out after 30 seconds." },
			});
			expect(fetch).toHaveBeenCalledOnce();
		} finally {
			vi.useRealTimers();
		}
	});
});
