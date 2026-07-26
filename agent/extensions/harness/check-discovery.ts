import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { parse } from "yaml";

export interface CheckDefinition {
	name: string;
	description?: string;
	severityDefault: string;
	body: string;
	path: string;
}

export interface CheckDiscoveryOptions {
	cwd: string;
	globalRoots?: readonly string[];
}

export const defaultCheckRoots = (): string[] => [
	join(homedir(), ".pi", "agent", "checks"),
	join(homedir(), ".agents", "checks"),
];

export function parseCheck(path: string, source: string): CheckDefinition | undefined {
	if (!source.trim()) return undefined;
	let body = source;
	let metadata: Record<string, unknown> = {};
	const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
	if (frontmatter) {
		try {
			const parsed = parse(frontmatter[1] ?? "");
			if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) metadata = parsed;
			body = source.slice(frontmatter[0].length);
		} catch {
			// Invalid frontmatter is treated as check instructions.
		}
	}
	const instructions = body.trim();
	if (!instructions) return undefined;
	const fallbackName = basename(path, extname(path));
	return {
		name: typeof metadata.name === "string" && metadata.name.trim() ? metadata.name.trim() : fallbackName,
		description:
			typeof metadata.description === "string" && metadata.description.trim()
				? metadata.description.trim()
				: undefined,
		severityDefault:
			typeof metadata["severity-default"] === "string" && metadata["severity-default"].trim()
				? metadata["severity-default"].trim()
				: "medium",
		body: instructions,
		path,
	};
}

export async function loadCheck(path: string): Promise<CheckDefinition | undefined> {
	return parseCheck(path, await readFile(path, "utf8"));
}

async function readChecks(directory: string): Promise<CheckDefinition[]> {
	let entries: Dirent[];
	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	const checks: CheckDefinition[] = [];
	for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
		if (!entry.isFile() || extname(entry.name) !== ".md") continue;
		const path = join(directory, entry.name);
		const parsed = await loadCheck(path);
		if (parsed) checks.push(parsed);
	}
	return checks;
}

export async function discoverChecks(options: CheckDiscoveryOptions): Promise<CheckDefinition[]> {
	const directories: string[] = [];
	let current = options.cwd;
	while (true) {
		directories.push(join(current, ".agents", "checks"));
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	directories.push(...(options.globalRoots ?? defaultCheckRoots()));

	const discovered = new Map<string, CheckDefinition>();
	for (const directory of directories) {
		for (const check of await readChecks(directory)) {
			if (!discovered.has(check.name)) discovered.set(check.name, check);
		}
	}
	return [...discovered.values()];
}
