import { Context, Effect, Layer } from "effect";
import { readFileSync, statSync } from "node:fs";
import { SessionDb, type SessionMeta, type SearchHit, type ReindexResult, type ListOptions, type SearchOptions } from "./db.ts";
import { IndexError, WorkspaceNotFoundError, SessionNotFoundError, InvalidDateError } from "./errors.ts";

// --- Config ---

export class SessionSearchConfig extends Context.Tag("@session-search/Config")<
	SessionSearchConfig,
	{ readonly dbPath: string; readonly sessionsDir: string }
>() {}

// --- Service ---

export class SessionSearch extends Context.Tag("@session-search/SessionSearch")<
	SessionSearch,
	{
		readonly reindex: () => Effect.Effect<ReindexResult, IndexError>;
		readonly list: (opts: {
			workspace?: string;
			since?: string;
			limit?: number;
		}) => Effect.Effect<SessionMeta[], IndexError | WorkspaceNotFoundError | InvalidDateError>;
		readonly search: (
			query: string,
			opts?: { workspace?: string; since?: string; roles?: string[]; limit?: number },
		) => Effect.Effect<SearchHit[], IndexError | WorkspaceNotFoundError | InvalidDateError>;
		readonly readSession: (sessionId: string) => Effect.Effect<
			{ file: string; entries: string[] },
			IndexError | SessionNotFoundError
		>;
	}
>() {
	static readonly layer = Layer.effect(
		SessionSearch,
		Effect.gen(function* () {
			const config = yield* SessionSearchConfig;
			const db = new SessionDb(config.dbPath);

			const reindex = Effect.fn("SessionSearch.reindex")(function* () {
				return yield* Effect.try({
					try: () => db.reindex(config.sessionsDir),
					catch: (cause) => new IndexError({ message: "reindex failed", cause }),
				});
			});

			const resolveWorkspaces = Effect.fn("SessionSearch.resolveWorkspaces")(
				function* (filter?: string) {
					const all = db.workspaces();
					if (!filter) return all;
					const lw = filter.toLowerCase();
					const matched = all.filter(
						(w) => w.toLowerCase().includes(lw) || decodeWorkspace(w).toLowerCase().includes(lw),
					);
					if (matched.length === 0) {
						return yield* new WorkspaceNotFoundError({
							filter,
							available: all.map(decodeWorkspace),
						});
					}
					return matched;
				},
			);

			const resolveSince = Effect.fn("SessionSearch.resolveSince")(function* (since?: string) {
				if (!since) return undefined;
				const daysMatch = since.match(/^(\d+)d$/);
				if (daysMatch) {
					return new Date(Date.now() - parseInt(daysMatch[1]!) * 86400000).toISOString();
				}
				const d = new Date(since);
				if (isNaN(d.getTime())) return yield* new InvalidDateError({ input: since });
				return d.toISOString();
			});

			const list = Effect.fn("SessionSearch.list")(function* (opts: {
				workspace?: string;
				since?: string;
				limit?: number;
			}) {
				yield* reindex();
				const workspaces = yield* resolveWorkspaces(opts.workspace);
				const since = yield* resolveSince(opts.since);
				return yield* Effect.try({
					try: () => db.list({ workspaces, since, limit: opts.limit ?? 20 } satisfies ListOptions),
					catch: (cause) => new IndexError({ message: "list query failed", cause }),
				});
			});

			const search = Effect.fn("SessionSearch.search")(function* (
				query: string,
				opts?: { workspace?: string; since?: string; roles?: string[]; limit?: number },
			) {
				yield* reindex();
				const workspaces = yield* resolveWorkspaces(opts?.workspace);
				const since = yield* resolveSince(opts?.since);
				return yield* Effect.try({
					try: () =>
						db.search(query, {
							workspaces,
							since,
							roles: opts?.roles,
							limit: opts?.limit ?? 10,
						} satisfies SearchOptions),
					catch: (cause) => new IndexError({ message: "search query failed", cause }),
				});
			});

			const readSession = Effect.fn("SessionSearch.readSession")(function* (sessionId: string) {
				yield* reindex();

				// Try as file path first
				let targetFile: string | null = null;
				try {
					if (statSync(sessionId).isFile()) targetFile = sessionId;
				} catch {
					// not a path — search index
				}

				if (!targetFile) {
					const found = db.findSession(sessionId);
					if (found) targetFile = found.file;
				}

				if (!targetFile) return yield* new SessionNotFoundError({ sessionId });

				return yield* Effect.try({
					try: () => ({
						file: targetFile,
						entries: readFileSync(targetFile, "utf8").split("\n").filter(Boolean),
					}),
					catch: (cause) => new IndexError({ message: `failed to read ${targetFile}`, cause }),
				});
			});

			return { reindex, list, search, readSession };
		}),
	);
}

// --- Helpers ---

function decodeWorkspace(encoded: string): string {
	return encoded.replace(/^--/, "").replace(/--$/, "").replace(/-/g, "/");
}

export { decodeWorkspace };
