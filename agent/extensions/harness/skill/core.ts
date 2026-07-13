/**
 * Skill tool — pure logic.
 *
 * Everything model-facing that doesn't need the extension runtime lives
 * here so it's unit-testable: trigger matching, directive construction,
 * miss-path ranking, skill content rendering, resources listing.
 */

import { type Dirent, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fuzzyFilter } from "@earendil-works/pi-tui";

const MAX_LISTED_FILES = 20;
const SKIP_DIRS = new Set(["node_modules", "__pycache__"]);

// The sigils that mark a skill reference. Feeds both the prompt-scanning
// pattern (buildSkillRefPattern) and the autocomplete provider's token matcher.
export const SKILL_TRIGGERS = ["$", "/"] as const;
export const TRIGGER_CLASS = `[${SKILL_TRIGGERS.join("")}]`;

export type SkillEntry = {
	name: string;
	description: string;
	filePath: string;
	baseDir: string;
};

// ── Trigger matching ──────────────────────────────────────────────

// The skill corpus is the token grammar: build the matcher from the loaded
// names so every match is a valid skill by construction. Longest-first
// alternation + lookahead keep `$tdd` from matching inside `$tdd-review`.
// The trailing lookahead excludes `/` and extension-like `.xx` so path
// fragments (`/tdd/refs.md`, `/tdd.md`) don't false-positive, while
// sentence-end punctuation (`use /tdd.`) still matches; the lookbehind
// already blocks `skills/tdd`.
export function buildSkillRefPattern(names: readonly string[]): RegExp | null {
	if (names.length === 0) return null;
	const alternatives = [...names]
		.sort((a, b) => b.length - a.length)
		.map((name) => name.replace(/[\\^$.*+?()[\]{}|-]/g, "\\$&"))
		.join("|");
	return new RegExp(`(?<=^|[\\s([{"'\`])${TRIGGER_CLASS}(${alternatives})(?![\\w/-]|\\.\\w)`, "gm");
}

/** All distinct skill names referenced in a prompt, in first-occurrence order. */
export function extractSkillRefs(prompt: string, names: readonly string[]): string[] {
	const pattern = buildSkillRefPattern(names);
	if (!pattern) return [];
	return [...new Set([...prompt.matchAll(pattern)].map((m) => m[1]!))];
}

// ── Directive ─────────────────────────────────────────────────────

/** Compressed hidden directive injected when a prompt references skills. */
export function buildDirective(names: readonly string[]): string {
	return [
		"<skill_directive>",
		"The user invoked these skills. Before anything else, call the skill tool once per name below, then follow the returned instructions.",
		...names.map((name) => `<skill>${name}</skill>`),
		"</skill_directive>",
	].join("\n");
}

// ── Miss path ─────────────────────────────────────────────────────

/**
 * Fuzzy-rank the corpus against the attempted name: matches first (best
 * first), then every remaining name in original order. Untruncated — the
 * miss-path list is load-bearing for prose activation.
 */
export function rankSkillNames(names: readonly string[], query: string): string[] {
	const matched = fuzzyFilter([...names], query, (n) => n);
	const rest = names.filter((n) => !matched.includes(n));
	return [...matched, ...rest];
}

export function availableSkillsBlock(names: readonly string[], query: string): string {
	if (names.length === 0) return "<available_skills>(none)</available_skills>";
	const lines = ["<available_skills>"];
	for (const name of rankSkillNames(names, query)) lines.push(`  <skill>${name}</skill>`);
	lines.push("</available_skills>");
	return lines.join("\n");
}

// ── Skill content ─────────────────────────────────────────────────

export function stripFrontmatter(content: string): string {
	if (!content.startsWith("---")) return content;
	const end = content.indexOf("\n---", 3);
	if (end === -1) return content;
	return content.slice(end + 4).trim();
}

export function listSkillFiles(baseDir: string): { files: string[]; truncated: boolean } {
	const files: string[] = [];
	let truncated = false;
	const walk = (dir: string): void => {
		if (truncated) return;
		let entries: Dirent[];
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (truncated) return;
			if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full);
			} else if (entry.isFile() && entry.name !== "SKILL.md") {
				if (files.length >= MAX_LISTED_FILES) {
					truncated = true;
					return;
				}
				files.push(relative(baseDir, full));
			}
		}
	};
	walk(baseDir);
	return { files, truncated };
}

export function renderSkillContent(skill: SkillEntry): string {
	const raw = readFileSync(skill.filePath, "utf-8");
	const body = stripFrontmatter(raw).trim();
	const { files, truncated } = listSkillFiles(skill.baseDir);

	const lines = [
		`<skill_content name="${skill.name}">`,
		body,
		"",
		`Skill directory: ${skill.baseDir}`,
		"Relative paths in this skill are relative to the skill directory. Use absolute paths in tool calls.",
	];
	if (files.length > 0) {
		lines.push("", "<skill_resources>");
		for (const f of files) lines.push(`  <file>${f}</file>`);
		if (truncated) lines.push("  (listing truncated)");
		lines.push("</skill_resources>");
	}
	lines.push("</skill_content>");
	return lines.join("\n");
}
