import path from "node:path";
import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import { getGlobalAgentDir } from "./modes.ts";

// =============================================================================
// Types & constants
// =============================================================================

export interface PromptEntry {
	text: string;
	timestamp: number;
}

const MAX_HISTORY_ENTRIES = 100;
const MAX_RECENT_PROMPTS = 30;

// =============================================================================
// Helpers
// =============================================================================

function extractText(content: Array<{ type: string; text?: string }>): string {
	return content
		.filter((item) => item.type === "text" && typeof item.text === "string")
		.map((item) => item.text ?? "")
		.join("")
		.trim();
}

export function collectUserPromptsFromEntries(entries: Array<any>): PromptEntry[] {
	const prompts: PromptEntry[] = [];
	for (const entry of entries) {
		if (entry?.type !== "message") continue;
		const message = entry?.message;
		if (!message || message.role !== "user" || !Array.isArray(message.content)) continue;
		const text = extractText(message.content);
		if (!text) continue;
		prompts.push({ text, timestamp: Number(message.timestamp ?? entry.timestamp ?? Date.now()) });
	}
	return prompts;
}

// =============================================================================
// Session file scanning
// =============================================================================

function getSessionDirForCwd(cwd: string): string {
	const safePath = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	return path.join(getGlobalAgentDir(), "sessions", safePath);
}

async function readTail(filePath: string, maxBytes = 256 * 1024): Promise<string> {
	let fileHandle: fs.FileHandle | undefined;
	try {
		const size = (await fs.stat(filePath)).size;
		const start = Math.max(0, size - maxBytes);
		const length = size - start;
		if (length <= 0) return "";

		const buffer = Buffer.alloc(length);
		fileHandle = await fs.open(filePath, "r");
		const { bytesRead } = await fileHandle.read(buffer, 0, length, start);
		if (bytesRead === 0) return "";

		let chunk = buffer.subarray(0, bytesRead).toString("utf8");
		// If we started mid-file, skip to the first complete line.
		if (start > 0) {
			const firstNewline = chunk.indexOf("\n");
			if (firstNewline !== -1) chunk = chunk.slice(firstNewline + 1);
		}
		return chunk;
	} catch {
		return "";
	} finally {
		await fileHandle?.close();
	}
}

export async function loadPromptHistoryForCwd(cwd: string, excludeSessionFile?: string): Promise<PromptEntry[]> {
	const sessionDir = getSessionDirForCwd(path.resolve(cwd));
	const resolvedExclude = excludeSessionFile ? path.resolve(excludeSessionFile) : undefined;
	const prompts: PromptEntry[] = [];

	let entries: Dirent[] = [];
	try {
		entries = await fs.readdir(sessionDir, { withFileTypes: true });
	} catch {
		return prompts;
	}

	const files = await Promise.all(
		entries
			.filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
			.map(async (entry) => {
				const filePath = path.join(sessionDir, entry.name);
				try {
					return { filePath, mtimeMs: (await fs.stat(filePath)).mtimeMs };
				} catch {
					return undefined;
				}
			}),
	);

	const sortedFiles = files
		.filter((file): file is { filePath: string; mtimeMs: number } => Boolean(file))
		.sort((a, b) => b.mtimeMs - a.mtimeMs);

	for (const file of sortedFiles) {
		if (resolvedExclude && path.resolve(file.filePath) === resolvedExclude) continue;

		const tail = await readTail(file.filePath);
		if (!tail) continue;

		for (const line of tail.split("\n").filter(Boolean)) {
			let entry: any;
			try {
				entry = JSON.parse(line);
			} catch {
				continue;
			}
			if (entry?.type !== "message") continue;
			const message = entry?.message;
			if (!message || message.role !== "user" || !Array.isArray(message.content)) continue;
			const text = extractText(message.content);
			if (!text) continue;
			prompts.push({ text, timestamp: Number(message.timestamp ?? entry.timestamp ?? Date.now()) });
			if (prompts.length >= MAX_RECENT_PROMPTS) break;
		}
		if (prompts.length >= MAX_RECENT_PROMPTS) break;
	}

	return prompts;
}

// =============================================================================
// History list building
// =============================================================================

export function buildHistoryList(currentSession: PromptEntry[], previousSessions: PromptEntry[]): PromptEntry[] {
	const all = [...currentSession, ...previousSessions];
	all.sort((a, b) => a.timestamp - b.timestamp);

	const seen = new Set<string>();
	const deduped: PromptEntry[] = [];
	for (const prompt of all) {
		const key = `${prompt.timestamp}:${prompt.text}`;
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push(prompt);
	}

	return deduped.slice(-MAX_HISTORY_ENTRIES);
}

export function historiesMatch(a: PromptEntry[], b: PromptEntry[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i += 1) {
		if (a[i]?.text !== b[i]?.text || a[i]?.timestamp !== b[i]?.timestamp) return false;
	}
	return true;
}
