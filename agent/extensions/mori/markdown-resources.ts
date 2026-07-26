/**
 * Markdown resources — the generic primitive under Check discovery: frontmatter'd
 * `.md` files loaded from a directory's direct children. Mirrors pi's skill
 * discovery contract, but keeps the frontmatter and body that pi's `Skill` type
 * drops — the reason this module exists. Delete it if pi ever exposes them.
 */
import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { parse } from "yaml";

export interface MarkdownResource {
	/** Frontmatter `name`, falling back to the filename stem. */
	name: string;
	description?: string;
	frontmatter: Record<string, unknown>;
	body: string;
	path: string;
}

/** Parse one resource; `undefined` when the body is empty. */
export function parseMarkdownResource(path: string, source: string): MarkdownResource | undefined {
	if (!source.trim()) return undefined;
	let body = source;
	let frontmatter: Record<string, unknown> = {};
	const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
	if (match) {
		try {
			const parsed = parse(match[1] ?? "");
			if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
				throw new Error("frontmatter must be a YAML object");
			frontmatter = parsed;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (message === "frontmatter must be a YAML object") throw new Error(`${path}: ${message}`);
			throw new Error(`${path}: invalid YAML frontmatter: ${message}`);
		}
		body = source.slice(match[0].length);
	}
	const trimmed = body.trim();
	if (!trimmed) return undefined;
	return {
		name:
			typeof frontmatter.name === "string" && frontmatter.name.trim()
				? frontmatter.name.trim()
				: basename(path, extname(path)),
		description:
			typeof frontmatter.description === "string" && frontmatter.description.trim()
				? frontmatter.description.trim()
				: undefined,
		frontmatter,
		body: trimmed,
		path,
	};
}

export async function loadMarkdownResource(path: string): Promise<MarkdownResource | undefined> {
	return parseMarkdownResource(path, await readFile(path, "utf8"));
}

/** Direct `.md` children of a directory, name-sorted; a missing directory is empty. */
export async function readMarkdownResources(directory: string): Promise<MarkdownResource[]> {
	let entries: Dirent[];
	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	const resources: MarkdownResource[] = [];
	for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
		if (!entry.isFile() || extname(entry.name) !== ".md") continue;
		const resource = await loadMarkdownResource(join(directory, entry.name));
		if (resource) resources.push(resource);
	}
	return resources;
}
