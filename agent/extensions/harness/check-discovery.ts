/**
 * Check discovery — finds the Checks (Markdown-defined mechanical review
 * scans) that apply to a working directory and refines them into typed
 * definitions. Precedence: nearest ancestor `.agents/checks` first, then the
 * global roots, first name wins.
 */
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { loadMarkdownResource, type MarkdownResource, readMarkdownResources } from "./markdown-resources.ts";
import { parseSeverity, type ReviewSeverity, reviewSeverities } from "./tools/review-comment.ts";

export interface CheckDefinition {
	name: string;
	description?: string;
	severityDefault: ReviewSeverity;
	globs?: string[];
	body: string;
	path: string;
}

export interface CheckDiscoveryOptions {
	cwd: string;
	globalRoots?: readonly string[];
}

const defaultGlobalRoots = (): string[] => [
	join(homedir(), ".pi", "agent", "checks"),
	join(homedir(), ".agents", "checks"),
];

/** Every directory Checks may live in for this cwd: ancestor `.agents/checks` walk (nearest first), then the global roots. */
export function checkDirectories(options: CheckDiscoveryOptions): string[] {
	const directories: string[] = [];
	let current = options.cwd;
	while (true) {
		directories.push(join(current, ".agents", "checks"));
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	directories.push(...(options.globalRoots ?? defaultGlobalRoots()));
	return directories;
}

/** Refine a Markdown resource into a Check; a malformed `severity-default` fails loudly, naming the file. */
function checkFromResource(resource: MarkdownResource): CheckDefinition {
	const raw = resource.frontmatter["severity-default"];
	let severityDefault: ReviewSeverity = "medium";
	if (raw !== undefined) {
		const parsed = typeof raw === "string" ? parseSeverity(raw.trim()) : undefined;
		if (!parsed)
			throw new Error(
				`${resource.path}: severity-default ${JSON.stringify(raw)} must be one of ${reviewSeverities.join("|")}`,
			);
		severityDefault = parsed;
	}
	const rawGlobs = resource.frontmatter.globs;
	let globs: string[] | undefined;
	if (rawGlobs !== undefined) {
		if (typeof rawGlobs === "string") globs = [rawGlobs];
		else if (Array.isArray(rawGlobs) && rawGlobs.every((glob) => typeof glob === "string")) globs = rawGlobs;
		else throw new Error(`${resource.path}: globs ${JSON.stringify(rawGlobs)} must be a string or list of strings`);
	}
	return {
		name: resource.name,
		description: resource.description,
		severityDefault,
		...(globs ? { globs } : {}),
		body: resource.body,
		path: resource.path,
	};
}

export async function loadCheck(path: string): Promise<CheckDefinition | undefined> {
	const resource = await loadMarkdownResource(path);
	return resource && checkFromResource(resource);
}

/** Discover every applicable Check across the precedence walk; the first definition of a name wins. */
export async function discoverChecks(options: CheckDiscoveryOptions): Promise<CheckDefinition[]> {
	const discovered = new Map<string, CheckDefinition>();
	for (const directory of checkDirectories(options)) {
		for (const resource of await readMarkdownResources(directory)) {
			const check = checkFromResource(resource);
			if (!discovered.has(check.name)) discovered.set(check.name, check);
		}
	}
	return [...discovered.values()];
}
