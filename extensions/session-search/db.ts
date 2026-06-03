import Database from "better-sqlite3";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// --- Types ---

export interface SessionMeta {
	id: string;
	file: string;
	workspace: string;
	timestamp: string;
	cwd: string | null;
	name: string | null;
	model: string | null;
	messageCount: number;
	totalCost: number;
}

export interface ReindexResult {
	indexed: number;
	skipped: number;
}

export interface ListOptions {
	workspaces?: string[];
	since?: string;
	limit?: number;
}

export interface SearchOptions {
	workspaces?: string[];
	since?: string;
	roles?: string[];
	limit?: number;
}

export interface SearchHit {
	sessionId: string;
	sessionName: string | null;
	timestamp: string;
	workspace: string;
	role: string;
	toolName: string;
	snippet: string;
	rank: number;
}

// --- Helpers ---

function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((b: any) => b.type === "text")
		.map((b: any) => b.text)
		.join("\n");
}

function inClause(items: string[]): { sql: string; params: string[] } {
	return { sql: items.map(() => "?").join(","), params: items };
}

/**
 * Escape a raw user query for FTS5 MATCH.
 * Wraps each token in double quotes so characters like `-`, `:`, `/`
 * aren't interpreted as FTS5 operators.
 */
function escapeFts5(query: string): string {
	return query
		.split(/\s+/)
		.filter(Boolean)
		.map((token) => `"${token.replace(/"/g, '""')}"`)
		.join(" ");
}

const SESSION_COLS = "id, file, workspace, timestamp, cwd, name, model, message_count, total_cost";

function rowToMeta(r: Record<string, any>): SessionMeta {
	return {
		id: r.id as string,
		file: r.file as string,
		workspace: r.workspace as string,
		timestamp: r.timestamp as string,
		cwd: r.cwd as string | null,
		name: r.name as string | null,
		model: r.model as string | null,
		messageCount: r.message_count as number,
		totalCost: r.total_cost as number,
	};
}

// --- Database ---

export class SessionDb {
	private db: Database.Database;

	constructor(dbPath: string) {
		this.db = new Database(dbPath);
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS sessions (
				id            TEXT PRIMARY KEY,
				file          TEXT UNIQUE,
				workspace     TEXT NOT NULL,
				timestamp     TEXT NOT NULL,
				cwd           TEXT,
				name          TEXT,
				model         TEXT,
				message_count INTEGER DEFAULT 0,
				total_cost    REAL DEFAULT 0,
				file_mtime    REAL NOT NULL,
				indexed_at    TEXT NOT NULL
			);
			CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace);
			CREATE INDEX IF NOT EXISTS idx_sessions_timestamp ON sessions(timestamp DESC);
			CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
				session_id UNINDEXED,
				role       UNINDEXED,
				tool_name  UNINDEXED,
				content,
				tokenize='porter unicode61'
			);
		`);
	}

	workspaces(): string[] {
		const rows = this.db.prepare(
			"SELECT DISTINCT workspace FROM sessions ORDER BY workspace",
		).all() as Array<{ workspace: string }>;
		return rows.map((r) => r.workspace);
	}

	reindex(sessionsDir: string): ReindexResult {
		let indexed = 0;
		let skipped = 0;

		const dirs = readdirSync(sessionsDir, { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.map((e) => e.name);

		const upsertSession = this.db.prepare(`
			INSERT OR REPLACE INTO sessions
				(id, file, workspace, timestamp, cwd, name, model, message_count, total_cost, file_mtime, indexed_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
		const deleteFts = this.db.prepare("DELETE FROM messages_fts WHERE session_id = ?");
		const insertFts = this.db.prepare(
			"INSERT INTO messages_fts (session_id, role, tool_name, content) VALUES (?, ?, ?, ?)",
		);
		const getMtime = this.db.prepare("SELECT file_mtime FROM sessions WHERE file = ?");

		for (const ws of dirs) {
			let files: string[];
			try {
				files = readdirSync(join(sessionsDir, ws)).filter((f) => f.endsWith(".jsonl"));
			} catch {
				continue;
			}

			for (const filename of files) {
				const filePath = join(sessionsDir, ws, filename);
				const mtime = statSync(filePath).mtimeMs;

				const existing = getMtime.get(filePath) as { file_mtime: number } | undefined;
				if (existing && existing.file_mtime === mtime) {
					skipped++;
					continue;
				}

				const lines = readFileSync(filePath, "utf8").split("\n").filter(Boolean);
				if (lines.length === 0) continue;

				let header: Record<string, any>;
				try {
					header = JSON.parse(lines[0]!);
				} catch {
					continue;
				}
				if (header.type !== "session") continue;

				const sessionId = String(header.id ?? "");
				let name: string | null = null;
				let model: string | null = null;
				let messageCount = 0;
				let totalCost = 0;

				deleteFts.run(sessionId);

				for (let i = 1; i < lines.length; i++) {
					let entry: Record<string, any>;
					try {
						entry = JSON.parse(lines[i]!);
					} catch {
						continue;
					}

					if (entry.type === "session_info" && entry.name) name = entry.name;
					if (entry.type === "model_change" && !model) model = `${entry.provider}/${entry.modelId}`;

					if (entry.type === "message") {
						const msg = entry.message;
						if (!msg) continue;
						const text = extractText(msg.content).slice(0, 2000);
						const role = msg.role ?? "";
						const toolName = msg.toolName ?? "";
						if (role === "user" || role === "assistant") messageCount++;
						if (role === "assistant" && msg.usage?.cost?.total) totalCost += msg.usage.cost.total;
						if (text) insertFts.run(sessionId, role, toolName, text);
					}
				}

				upsertSession.run(
					sessionId, filePath, ws, String(header.timestamp ?? ""),
					header.cwd ?? null, name, model, messageCount, totalCost,
					mtime, new Date().toISOString(),
				);
				indexed++;
			}
		}

		return { indexed, skipped };
	}

	list(opts: ListOptions): SessionMeta[] {
		const conditions: string[] = [];
		const params: (string | number)[] = [];

		if (opts.workspaces && opts.workspaces.length > 0) {
			const ic = inClause(opts.workspaces);
			conditions.push(`workspace IN (${ic.sql})`);
			params.push(...ic.params);
		}
		if (opts.since) {
			conditions.push("timestamp >= ?");
			params.push(opts.since);
		}

		const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		const limit = opts.limit ?? 100;

		const rows = this.db.prepare(
			`SELECT ${SESSION_COLS} FROM sessions ${where} ORDER BY timestamp DESC LIMIT ?`,
		).all(...params, limit) as Array<Record<string, any>>;

		return rows.map(rowToMeta);
	}

	search(query: string, opts: SearchOptions = {}): SearchHit[] {
		const conditions = ["messages_fts MATCH ?"];
		const params: (string | number)[] = [escapeFts5(query)];

		if (opts.workspaces && opts.workspaces.length > 0) {
			const ic = inClause(opts.workspaces);
			conditions.push(`s.workspace IN (${ic.sql})`);
			params.push(...ic.params);
		}
		if (opts.since) {
			conditions.push("s.timestamp >= ?");
			params.push(opts.since);
		}
		if (opts.roles && opts.roles.length > 0) {
			const ic = inClause(opts.roles);
			conditions.push(`m.role IN (${ic.sql})`);
			params.push(...ic.params);
		}

		const limit = opts.limit ?? 10;

		const rows = this.db.prepare(`
			SELECT
				s.id as session_id, s.name as session_name, s.timestamp, s.workspace,
				m.role, m.tool_name,
				snippet(messages_fts, 3, '>>>', '<<<', '…', 16) as snippet,
				rank
			FROM messages_fts m
			JOIN sessions s ON s.id = m.session_id
			WHERE ${conditions.join(" AND ")}
			ORDER BY rank
			LIMIT ?
		`).all(...params, limit) as Array<Record<string, any>>;

		return rows.map((r) => ({
			sessionId: r.session_id as string,
			sessionName: r.session_name as string | null,
			timestamp: r.timestamp as string,
			workspace: r.workspace as string,
			role: r.role as string,
			toolName: r.tool_name as string,
			snippet: r.snippet as string,
			rank: r.rank as number,
		}));
	}

	findSession(sessionId: string): SessionMeta | null {
		const tryQuery = (where: string, param: string) =>
			this.db.prepare(`SELECT ${SESSION_COLS} FROM sessions WHERE ${where}`).get(param) as Record<string, any> | undefined;

		const row =
			tryQuery("id = ?", sessionId) ??
			tryQuery("id LIKE ? LIMIT 1", sessionId + "%") ??
			tryQuery("name LIKE ? ORDER BY timestamp DESC LIMIT 1", "%" + sessionId + "%") ??
			tryQuery("file LIKE ? LIMIT 1", "%" + sessionId + "%");

		return row ? rowToMeta(row) : null;
	}

	close(): void {
		this.db.close();
	}
}
