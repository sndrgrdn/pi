/**
 * pi-fff: FFF-powered @-mention autocomplete extension for pi
 *
 * Replaces @-mention autocomplete suggestions in the interactive editor
 * with FFF-powered fuzzy file search ranked by frecency.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import type { AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions } from "@mariozechner/pi-tui";
import { FileFinder } from "@ff-labs/fff-node";
import type { MixedItem } from "@ff-labs/fff-node";
import { mkdirSync } from "fs";
import { join, resolve } from "path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FFF_DB_DIR = join(getAgentDir(), "fff");
const FRECENCY_DB_PATH = join(FFF_DB_DIR, "frecency.mdb");
const HISTORY_DB_PATH = join(FFF_DB_DIR, "history.mdb");
const MENTION_MAX_RESULTS = 20;

// ---------------------------------------------------------------------------
// Mention autocomplete helpers
// ---------------------------------------------------------------------------

function extractAtPrefix(textBeforeCursor: string): string | null {
	const match = textBeforeCursor.match(/(?:^|[ \t])(@(?:"[^"]*|[^\s]*))$/);
	return match?.[1] ?? null;
}

function parseAtPrefix(prefix: string): { raw: string; quoted: boolean } {
	if (prefix.startsWith('@"')) {
		return { raw: prefix.slice(2), quoted: true };
	}
	return { raw: prefix.slice(1), quoted: false };
}

function buildAtCompletionValue(path: string, quotedPrefix: boolean): string {
	if (quotedPrefix || path.includes(" ")) {
		return `@"${path}"`;
	}
	return `@${path}`;
}

class FffAtMentionProvider implements AutocompleteProvider {
	constructor(
		private base: AutocompleteProvider,
		private getItems: (query: string, quotedPrefix: boolean, signal: AbortSignal) => Promise<AutocompleteItem[]>,
	) {}

	async getSuggestions(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		options: { signal: AbortSignal; force?: boolean },
	): Promise<AutocompleteSuggestions | null> {
		const currentLine = lines[cursorLine] || "";
		const textBeforeCursor = currentLine.slice(0, cursorCol);
		const atPrefix = extractAtPrefix(textBeforeCursor);

		if (!atPrefix) {
			return this.base.getSuggestions(lines, cursorLine, cursorCol, options);
		}

		const { raw, quoted } = parseAtPrefix(atPrefix);
		if (options.signal.aborted) return null;

		try {
			const items = await this.getItems(raw, quoted, options.signal);
			if (options.signal.aborted) return null;
			if (items.length === 0) return null;
			return { items, prefix: atPrefix };
		} catch {
			// If FFF lookup fails unexpectedly, fall back to built-in provider.
			return this.base.getSuggestions(lines, cursorLine, cursorCol, options);
		}
	}

	applyCompletion(lines: string[], cursorLine: number, cursorCol: number, item: AutocompleteItem, prefix: string) {
		return this.base.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
	}
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function fffExtension(pi: ExtensionAPI) {
	const MAX_FINDERS = 4;
	const finderPool = new Map<string, FileFinder>();
	let activeCwd = process.cwd();

	try {
		mkdirSync(FFF_DB_DIR, { recursive: true });
	} catch {
		// ignore
	}

	async function ensureFinder(basePath: string): Promise<FileFinder> {
		const key = resolve(basePath);

		// Return existing finder if alive
		const existing = finderPool.get(key);
		if (existing && !existing.isDestroyed) {
			// Move to end (most recent) by re-inserting
			finderPool.delete(key);
			finderPool.set(key, existing);
			return existing;
		}

		// Evict oldest if at capacity
		if (finderPool.size >= MAX_FINDERS) {
			const oldestKey = finderPool.keys().next().value!;
			const oldest = finderPool.get(oldestKey);
			if (oldest && !oldest.isDestroyed) oldest.destroy();
			finderPool.delete(oldestKey);
		}

		// Only the primary finder (activeCwd) gets frecency/history dbs.
		// LMDB only allows one open env per db path per process.
		const isPrimary = key === resolve(activeCwd);
		const result = FileFinder.create({
			basePath: key,
			...(isPrimary ? { frecencyDbPath: FRECENCY_DB_PATH, historyDbPath: HISTORY_DB_PATH } : {}),
			aiMode: true,
		});

		if (!result.ok) {
			throw new Error(`Failed to create FFF file finder: ${result.error}`);
		}

		const finder = result.value;
		finderPool.set(key, finder);
		const scanResult = await finder.waitForScan(15000);
		if (scanResult.ok && !scanResult.value) {
			// timed out but finder is still usable with partial index
		}

		return finder;
	}

	function destroyAllFinders() {
		for (const [key, f] of finderPool) {
			if (!f.isDestroyed) f.destroy();
			finderPool.delete(key);
		}
	}

	async function getMentionItems(query: string, quotedPrefix: boolean, signal: AbortSignal): Promise<AutocompleteItem[]> {
		if (signal.aborted) return [];
		const f = await ensureFinder(activeCwd);
		if (signal.aborted) return [];

		const searchResult = f.mixedSearch(query, { pageSize: MENTION_MAX_RESULTS });
		if (!searchResult.ok) return [];

		return searchResult.value.items.slice(0, MENTION_MAX_RESULTS).map((mixed: MixedItem) => {
			if (mixed.type === "directory") {
				return {
					value: buildAtCompletionValue(mixed.item.relativePath, quotedPrefix),
					label: mixed.item.dirName,
					description: mixed.item.relativePath,
				};
			}
			return {
				value: buildAtCompletionValue(mixed.item.relativePath, quotedPrefix),
				label: mixed.item.fileName,
				description: mixed.item.relativePath,
			};
		});
	}

	function applyAutocomplete(ctx: { ui: { addAutocompleteProvider: (factory: (current: AutocompleteProvider) => AutocompleteProvider) => void } }) {
		ctx.ui.addAutocompleteProvider((baseProvider) => new FffAtMentionProvider(baseProvider, getMentionItems));
	}

	// --- Lifecycle ---

	pi.on("session_start", async (_event, ctx) => {
		try {
			activeCwd = ctx.cwd;
			await ensureFinder(activeCwd);
			applyAutocomplete(ctx);
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			ctx.ui.notify(`FFF init failed: ${msg}`, "error");
		}
	});

	pi.on("session_shutdown", async () => {
		destroyAllFinders();
	});

	// --- Commands ---

	pi.registerCommand("fff-health", {
		description: "Show FFF file finder health and status",
		handler: async (_args, ctx) => {
			if (finderPool.size === 0) {
				ctx.ui.notify("FFF not initialized (no finders)", "warning");
				return;
			}

			const allLines: string[] = [];
			for (const [key, f] of finderPool) {
				if (f.isDestroyed) continue;
				const health = f.healthCheck();
				if (!health.ok) {
					allLines.push(`[${key}] Health check failed: ${health.error}`);
					continue;
				}
				const h = health.value;
				allLines.push(
					`[${key}]`,
					`  FFF v${h.version}`,
					`  Git: ${h.git.repositoryFound ? `yes (${h.git.workdir ?? "unknown"})` : "no"}`,
					`  Picker: ${h.filePicker.initialized ? `${h.filePicker.indexedFiles ?? 0} files` : "not initialized"}`,
				);
				const progress = f.getScanProgress();
				if (progress.ok) {
					allLines.push(`  Scanning: ${progress.value.isScanning ? "yes" : "no"} (${progress.value.scannedFilesCount} files)`);
				}
			}
			allLines.unshift(`Finders: ${finderPool.size}`);
			ctx.ui.notify(allLines.join("\n"), "info");
		},
	});

	pi.registerCommand("fff-rescan", {
		description: "Trigger FFF to rescan files",
		handler: async (_args, ctx) => {
			if (finderPool.size === 0) {
				ctx.ui.notify("FFF not initialized (no finders)", "warning");
				return;
			}

			let ok = 0;
			for (const [key, f] of finderPool) {
				if (f.isDestroyed) continue;
				const result = f.scanFiles();
				if (result.ok) ok++;
			}

			ctx.ui.notify(`FFF rescan triggered for ${ok} finder(s)`, "info");
		},
	});
}
