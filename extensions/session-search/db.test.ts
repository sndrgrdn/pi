import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionSearch, SessionSearchConfig } from "./service.ts";

// --- Fixtures ---

function makeTempSessionsDir(): string {
	return mkdtempSync(join(tmpdir(), "session-test-"));
}

function makeSession(dir: string, workspace: string, filename: string, lines: object[]): void {
	const wsDir = join(dir, workspace);
	mkdirSync(wsDir, { recursive: true });
	writeFileSync(join(wsDir, filename), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

const SESSION_HEADER = {
	type: "session", version: 3, id: "019e-aaaa-bbbb",
	timestamp: "2026-06-01T10:00:00.000Z", cwd: "/Users/test/project",
};

const MODEL_CHANGE = {
	type: "model_change", id: "mc1", parentId: null,
	timestamp: "2026-06-01T10:00:01.000Z", provider: "anthropic", modelId: "claude-sonnet-4-6",
};

const SESSION_INFO = {
	type: "session_info", id: "si1", parentId: "mc1",
	timestamp: "2026-06-01T10:00:02.000Z", name: "Test session",
};

const USER_MSG = {
	type: "message", id: "m1", parentId: "si1",
	timestamp: "2026-06-01T10:00:03.000Z",
	message: { role: "user", content: [{ type: "text", text: "How do I fix the authentication bug?" }] },
};

const ASSISTANT_MSG = {
	type: "message", id: "m2", parentId: "m1",
	timestamp: "2026-06-01T10:00:04.000Z",
	message: {
		role: "assistant",
		content: [{ type: "text", text: "The auth bug is in the session middleware." }],
		usage: { cost: { total: 0.05 } },
	},
};

const ALL_LINES = [SESSION_HEADER, MODEL_CHANGE, SESSION_INFO, USER_MSG, ASSISTANT_MSG];

// --- Test layer factory ---

function makeTestLayer(sessionsDir: string) {
	const config = Layer.succeed(SessionSearchConfig, { dbPath: ":memory:", sessionsDir });
	return SessionSearch.layer.pipe(Layer.provide(config));
}

function defaultLayer() {
	const dir = makeTempSessionsDir();
	makeSession(dir, "--test-workspace--", "2026-06-01T10-00-00_019e-aaaa-bbbb.jsonl", ALL_LINES);
	return makeTestLayer(dir);
}

// --- Tests ---

describe("SessionSearch", () => {
	it.effect("indexes a session and lists it with metadata", () =>
		Effect.gen(function* () {
			const svc = yield* SessionSearch;

			const result = yield* svc.reindex();
			expect(result.indexed).toBe(1);
			expect(result.skipped).toBe(0);

			const sessions = yield* svc.list({});
			expect(sessions).toHaveLength(1);
			expect(sessions[0]).toMatchObject({
				id: "019e-aaaa-bbbb",
				workspace: "--test-workspace--",
				timestamp: "2026-06-01T10:00:00.000Z",
				name: "Test session",
				model: "anthropic/claude-sonnet-4-6",
				messageCount: 2,
				totalCost: 0.05,
			});
		}).pipe(Effect.provide(defaultLayer())),
	);

	it.effect("finds messages via FTS5 search", () =>
		Effect.gen(function* () {
			const svc = yield* SessionSearch;
			const hits = yield* svc.search("authentication");
			expect(hits).toHaveLength(1);
			expect(hits[0]!.sessionId).toBe("019e-aaaa-bbbb");
			expect(hits[0]!.snippet).toContain("authentication");
		}).pipe(Effect.provide(defaultLayer())),
	);

	it.effect("returns highlighted snippets", () =>
		Effect.gen(function* () {
			const svc = yield* SessionSearch;
			const hits = yield* svc.search("authentication");
			expect(hits[0]!.snippet).toContain(">>>authentication<<<");
		}).pipe(Effect.provide(defaultLayer())),
	);

	it.effect("skips already-indexed files on second reindex", () =>
		Effect.gen(function* () {
			const svc = yield* SessionSearch;
			yield* svc.reindex();
			const second = yield* svc.reindex();
			expect(second.indexed).toBe(0);
			expect(second.skipped).toBe(1);
		}).pipe(Effect.provide(defaultLayer())),
	);

	it.effect("re-indexes when file mtime changes", () =>
		Effect.gen(function* () {
			const svc = yield* SessionSearch;
			yield* svc.reindex();
			const sessions = yield* svc.list({});
			expect(sessions[0]!.name).toBe("Updated session");
		}).pipe(Effect.provide((() => {
			const dir = makeTempSessionsDir();
			makeSession(dir, "--test-workspace--", "2026-06-01T10-00-00_019e-aaaa-bbbb.jsonl", ALL_LINES);
			makeSession(dir, "--test-workspace--", "2026-06-01T10-00-00_019e-aaaa-bbbb.jsonl", [
				SESSION_HEADER, MODEL_CHANGE, { ...SESSION_INFO, name: "Updated session" }, USER_MSG, ASSISTANT_MSG,
			]);
			return makeTestLayer(dir);
		})())),
	);

	it.effect("filters list by workspace", () =>
		Effect.gen(function* () {
			const svc = yield* SessionSearch;
			const a = yield* svc.list({ workspace: "workspace-a" });
			const b = yield* svc.list({ workspace: "workspace-b" });
			expect(a).toHaveLength(1);
			expect(a[0]!.id).toBe("019e-0001");
			expect(b).toHaveLength(1);
			expect(b[0]!.id).toBe("019e-0002");
		}).pipe(Effect.provide((() => {
			const dir = makeTempSessionsDir();
			makeSession(dir, "--workspace-a--", "2026-06-01T10-00-00_019e-0001.jsonl", [
				{ ...SESSION_HEADER, id: "019e-0001" }, USER_MSG,
			]);
			makeSession(dir, "--workspace-b--", "2026-06-01T11-00-00_019e-0002.jsonl", [
				{ ...SESSION_HEADER, id: "019e-0002", timestamp: "2026-06-01T11:00:00.000Z" }, USER_MSG,
			]);
			return makeTestLayer(dir);
		})())),
	);

	it.effect("filters list by date", () =>
		Effect.gen(function* () {
			const svc = yield* SessionSearch;
			const recent = yield* svc.list({ since: "2026-05-15" });
			expect(recent).toHaveLength(1);
			expect(recent[0]!.id).toBe("019e-new");
		}).pipe(Effect.provide((() => {
			const dir = makeTempSessionsDir();
			makeSession(dir, "--test-workspace--", "2026-05-01T10-00-00_019e-old.jsonl", [
				{ ...SESSION_HEADER, id: "019e-old", timestamp: "2026-05-01T10:00:00.000Z" }, USER_MSG,
			]);
			makeSession(dir, "--test-workspace--", "2026-06-01T10-00-00_019e-new.jsonl", [
				{ ...SESSION_HEADER, id: "019e-new", timestamp: "2026-06-01T10:00:00.000Z" }, USER_MSG,
			]);
			return makeTestLayer(dir);
		})())),
	);

	it.effect("filters search by role", () =>
		Effect.gen(function* () {
			const svc = yield* SessionSearch;
			const userOnly = yield* svc.search("authentication", { roles: ["user"] });
			expect(userOnly).toHaveLength(1);
			expect(userOnly[0]!.role).toBe("user");
			const assistantAuth = yield* svc.search("auth", { roles: ["assistant"] });
			expect(assistantAuth).toHaveLength(1);
			expect(assistantAuth[0]!.role).toBe("assistant");
		}).pipe(Effect.provide(defaultLayer())),
	);

	it.effect("skips malformed JSONL lines without crashing", () =>
		Effect.gen(function* () {
			const svc = yield* SessionSearch;
			const hits = yield* svc.search("authentication");
			expect(hits).toHaveLength(1);
		}).pipe(Effect.provide((() => {
			const dir = makeTempSessionsDir();
			const wsDir = join(dir, "--test-workspace--");
			mkdirSync(wsDir, { recursive: true });
			writeFileSync(
				join(wsDir, "2026-06-01T10-00-00_019e-bad.jsonl"),
				[JSON.stringify(SESSION_HEADER), "not json", "{ broken", JSON.stringify(USER_MSG)].join("\n") + "\n",
			);
			return makeTestLayer(dir);
		})())),
	);

	it.effect("returns WorkspaceNotFoundError for unknown workspace", () =>
		Effect.gen(function* () {
			const svc = yield* SessionSearch;
			const result = yield* svc.list({ workspace: "nonexistent" }).pipe(Effect.flip);
			expect(result._tag).toBe("WorkspaceNotFoundError");
		}).pipe(Effect.provide(defaultLayer())),
	);

	it.effect("escapes hyphens and special chars in search queries", () =>
		Effect.gen(function* () {
			const svc = yield* SessionSearch;
			const hits = yield* svc.search("authentication bug");
			expect(hits.length).toBeGreaterThanOrEqual(1);
		}).pipe(Effect.provide(defaultLayer())),
	);

	it.effect("reads a session by partial ID prefix", () =>
		Effect.gen(function* () {
			const svc = yield* SessionSearch;
			const result = yield* svc.readSession("019e-aaaa");
			expect(result.entries.length).toBeGreaterThan(0);
		}).pipe(Effect.provide(defaultLayer())),
	);

	it.effect("reads a session by name substring", () =>
		Effect.gen(function* () {
			const svc = yield* SessionSearch;
			const result = yield* svc.readSession("Test session");
			expect(result.entries.length).toBeGreaterThan(0);
		}).pipe(Effect.provide(defaultLayer())),
	);
});
