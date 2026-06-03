import { Effect, Layer } from "effect";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { keyHint, truncateHead, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { join } from "node:path";
import { homedir } from "node:os";
import { SessionSearch, SessionSearchConfig, decodeWorkspace } from "./service.ts";
import type { SessionMeta, SearchHit } from "./db.ts";

// --- Config ---

const SESSIONS_DIR = join(homedir(), ".pi", "agent", "sessions");
const INDEX_PATH = join(SESSIONS_DIR, "index.sqlite");

const configLayer = Layer.succeed(SessionSearchConfig, {
	dbPath: INDEX_PATH,
	sessionsDir: SESSIONS_DIR,
});

const appLayer = SessionSearch.layer.pipe(Layer.provide(configLayer));

// --- Rendering types ---

type SessionSearchDetails =
	| { action: "list"; total: number; sessions: SessionMeta[] }
	| { action: "search"; query: string; hits: SearchHit[] }
	| { action: "read"; sessionId: string; text: string };

// --- Formatting ---

function formatMetaCompact(meta: SessionMeta, theme: any): string {
	const date = theme.fg("dim", (meta.timestamp.split("T")[0] ?? ""));
	const label = meta.name ?? "(unnamed)";
	const cost = meta.totalCost ? theme.fg("dim", ` $${meta.totalCost.toFixed(2)}`) : "";
	return `  ${date}  ${theme.fg("text", label)}${cost}`;
}

function formatMetaExpanded(meta: SessionMeta, theme: any): string {
	const date = theme.fg("dim", (meta.timestamp.split("T")[0] ?? ""));
	const label = meta.name ?? "(unnamed)";
	const cost = meta.totalCost ? theme.fg("dim", ` $${meta.totalCost.toFixed(2)}`) : "";
	const model = meta.model ? theme.fg("dim", ` [${meta.model}]`) : "";
	return [
		`  ${date}  ${theme.fg("text", label)}${model}${cost}`,
		`    ${theme.fg("dim", `id: ${meta.id}  msgs: ${meta.messageCount}  ws: ${decodeWorkspace(meta.workspace)}`)}`,
	].join("\n");
}

function formatMetaPlain(meta: SessionMeta): string {
	const date = meta.timestamp.split("T")[0];
	const label = meta.name ?? "(unnamed)";
	const cost = meta.totalCost ? ` $${meta.totalCost.toFixed(2)}` : "";
	const model = meta.model ? ` [${meta.model}]` : "";
	return [
		`${date}  ${label}${model}${cost}`,
		`  id: ${meta.id}`,
		`  workspace: ${decodeWorkspace(meta.workspace)}`,
		`  messages: ${meta.messageCount}  file: ${meta.file}`,
	].join("\n");
}

function formatHitPlain(hit: SearchHit): string {
	const date = hit.timestamp.split("T")[0];
	const name = hit.sessionName ?? "(unnamed)";
	const snippet = hit.snippet.replace(/>>>/g, "").replace(/<<</g, "");
	return `${date}  ${name}\n  id: ${hit.sessionId}\n  [${hit.role}] ${snippet}`;
}

// --- Read formatting ---

function formatEntry(entry: Record<string, any>): string | null {
	switch (entry.type) {
		case "session":
			return `=== Session ${entry.id} (v${entry.version}) ===\nStarted: ${entry.timestamp}  CWD: ${entry.cwd}\n`;
		case "session_info":
			return `📛 Session named: ${entry.name}\n`;
		case "model_change":
			return `🔄 Model: ${entry.provider}/${entry.modelId}`;
		case "thinking_level_change":
			return `🧠 Thinking: ${entry.thinkingLevel}`;
		case "compaction":
			return `📦 Compaction (${entry.tokensBefore} tokens before)\n   ${entry.summary?.slice(0, 200) ?? "(no summary)"}...\n`;
		case "message": {
			const msg = entry.message;
			if (!msg) return null;
			let text = "";
			if (typeof msg.content === "string") {
				text = msg.content;
			} else if (Array.isArray(msg.content)) {
				for (const block of msg.content) {
					if (block.type === "text") text += block.text + "\n";
					else if (block.type === "toolCall") text += `[tool: ${block.name}(${JSON.stringify(block.arguments).slice(0, 100)})]\n`;
					else if (block.type === "thinking") text += `[thinking: ${block.thinking.slice(0, 100)}...]\n`;
				}
			}
			const prefix =
				msg.role === "user" ? "👤 USER" :
				msg.role === "assistant" ? "🤖 ASSISTANT" :
				msg.role === "toolResult" ? `🔧 ${msg.toolName ?? "tool"}${msg.isError ? " ❌" : ""}` :
				`📌 ${msg.role}`;
			const maxLen = msg.role === "toolResult" ? 300 : 500;
			const trimmed = text.trim().slice(0, maxLen);
			const ellipsis = text.trim().length > maxLen ? "..." : "";
			return `${prefix}: ${trimmed}${ellipsis}\n`;
		}
		default:
			return null;
	}
}

// --- Extension ---

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "session_search",
		label: "Session Search",
		description:
			"Search through pi agent session history. Use to find past conversations by content, " +
			"name, date, workspace, or session ID. Supports listing recent sessions, searching " +
			"message content with context snippets, and reading session summaries. " +
			"Use this when the user asks about past sessions, wants to find a previous conversation, " +
			"or when you need to look up how something was done before.",
		promptSnippet: "Search past pi sessions by content, name, date, or workspace",
		promptGuidelines: [
			"Use session_search with action 'list' to browse recent sessions, optionally filtered by workspace or date.",
			"Use session_search with action 'search' and a query to find sessions containing specific text.",
			"Use session_search with action 'read' and a session ID to get the full conversation of a specific session.",
		],
		parameters: Type.Object({
			action: StringEnum(["list", "search", "read"] as const, {
				description:
					"'list' = browse sessions with optional filters, " +
					"'search' = find sessions by message content, " +
					"'read' = read a specific session by ID or path",
			}),
			query: Type.Optional(
				Type.String({
					description: "Search query for content matching (action=search). Case-insensitive substring match.",
				}),
			),
			workspace: Type.Optional(
				Type.String({
					description: "Filter by workspace path (partial match). e.g. 'booqable', 'pi-agent', 'career-ops'.",
				}),
			),
			since: Type.Optional(
				Type.String({
					description: "Only sessions after this date. ISO date like '2026-05-01' or relative like '7d' (days ago).",
				}),
			),
			session_id: Type.Optional(
				Type.String({
					description: "Session UUID or partial ID (action=read). Also accepts a file path.",
				}),
			),
			roles: Type.Optional(
				Type.Array(
					StringEnum(["user", "assistant", "toolResult"] as const),
					{ description: "Filter search to specific message roles. Default: all roles." },
				),
			),
			limit: Type.Optional(
				Type.Number({
					description: "Max results to return. Default: 20 for list, 10 for search.",
				}),
			),
		}),

		async execute(_toolCallId, params, _signal): Promise<{ content: { type: "text"; text: string }[]; details: SessionSearchDetails }> {
			const { action, query, workspace, since, session_id, roles, limit } = params;

			const program = Effect.gen(function* () {
				const svc = yield* SessionSearch;

				switch (action) {
					case "list": {
						const sessions = yield* svc.list({ workspace, since, limit: limit ?? 20 });
						const total = sessions.length;
						const text = total === 0
							? "No sessions found matching filters."
							: `Found ${total} sessions:\n\n` + sessions.map(formatMetaPlain).join("\n\n");
						const details: SessionSearchDetails = { action: "list", total, sessions };
						return { content: [{ type: "text" as const, text }], details };
					}

					case "search": {
						if (!query) return yield* Effect.fail(new Error("'query' is required for action=search."));
						const hits = yield* svc.search(query, { workspace, since, roles, limit: limit ?? 10 });
						const text = hits.length === 0
							? `No sessions found containing '${query}'.`
							: `Found ${hits.length} results for '${query}':\n\n` + hits.map(formatHitPlain).join("\n\n");
						const details: SessionSearchDetails = { action: "search", query, hits };
						return { content: [{ type: "text" as const, text }], details };
					}

					case "read": {
						if (!session_id) return yield* Effect.fail(new Error("'session_id' is required for action=read."));
						const { file, entries } = yield* svc.readSession(session_id);
						const parts: string[] = [`Session file: ${file}\n`];
						for (const line of entries) {
							try {
								const formatted = formatEntry(JSON.parse(line));
								if (formatted) parts.push(formatted);
							} catch {
								// skip malformed
							}
						}
						const output = parts.join("\n");
						const truncation = truncateHead(output, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
						let text = truncation.content;
						if (truncation.truncated) {
							text += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines ` +
								`(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).]`;
						}
						const details: SessionSearchDetails = { action: "read", sessionId: session_id, text: output };
						return { content: [{ type: "text" as const, text }], details };
					}

					default:
						return yield* Effect.fail(new Error(`Unknown action: ${action}`));
				}
			}).pipe(Effect.provide(appLayer));

			return Effect.runPromise(program);
		},

		renderCall(args, theme) {
			const action = typeof args.action === "string" ? args.action : "";
			let text = theme.fg("toolTitle", theme.bold("session_search ")) + theme.fg("muted", action);

			if (action === "search" && typeof args.query === "string") {
				text += " " + theme.fg("accent", `"${args.query}"`);
			}
			if (action === "read" && typeof args.session_id === "string") {
				const id = args.session_id.length > 13 ? args.session_id.slice(0, 13) + "…" : args.session_id;
				text += " " + theme.fg("accent", id);
			}
			if (typeof args.workspace === "string") {
				text += " " + theme.fg("dim", `ws:${args.workspace}`);
			}
			if (typeof args.since === "string") {
				text += " " + theme.fg("dim", `since:${args.since}`);
			}

			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded, isPartial }, theme) {
			const details = result.details as SessionSearchDetails | undefined;

			if (isPartial) return new Text(theme.fg("warning", "Searching…"), 0, 0);
			if (!details) {
				const t = result.content[0];
				return new Text(t?.type === "text" ? t.text : "", 0, 0);
			}

			if (details.action === "list") {
				const { total, sessions } = details;
				if (sessions.length === 0) return new Text(theme.fg("dim", "No sessions found."), 0, 0);
				const header = theme.fg("muted", `${total} session(s)`);
				const lines = sessions.map((s) => expanded ? formatMetaExpanded(s, theme) : formatMetaCompact(s, theme));
				let text = [header, ...lines].join("\n");
				if (!expanded) text += "\n" + theme.fg("dim", `(${keyHint("app.tools.expand", "to expand")})`);
				return new Text(text, 0, 0);
			}

			if (details.action === "search") {
				const { query, hits } = details;
				if (hits.length === 0) return new Text(theme.fg("dim", `No results for "${query}".`), 0, 0);
				const header = theme.fg("muted", `${hits.length} result(s) for "${query}"`);
				const lines: string[] = [];
				for (const hit of hits) {
					const date = theme.fg("dim", (hit.timestamp.split("T")[0] ?? ""));
					const name = hit.sessionName ?? "(unnamed)";
					lines.push(`  ${date}  ${theme.fg("text", name)}`);
					if (expanded) {
						const snippet = hit.snippet.replace(/>>>/g, "").replace(/<<</g, "");
						lines.push(`    ${theme.fg("dim", `[${hit.role}]`)} ${theme.fg("dim", snippet)}`);
					}
				}
				let text = [header, ...lines].join("\n");
				if (!expanded) text += "\n" + theme.fg("dim", `(${keyHint("app.tools.expand", "to expand")})`);
				return new Text(text, 0, 0);
			}

			if (details.action === "read") {
				if (!expanded) {
					const preview = details.text.split("\n").slice(0, 8).join("\n");
					const more = details.text.split("\n").length > 8;
					let text = preview;
					if (more) text += "\n" + theme.fg("dim", `(${keyHint("app.tools.expand", "to expand")})`);
					return new Text(text, 0, 0);
				}
				return new Text(details.text, 0, 0);
			}

			const t = result.content[0];
			return new Text(t?.type === "text" ? t.text : "", 0, 0);
		},
	});
}
