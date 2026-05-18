/**
 * Inline skill autocomplete extension.
 *
 * Type `#` in the editor to get a list of available skills.
 * Selecting a skill expands it on submit using the same format
 * as the native `/skill:name` command — collapsible `[skill]` block
 * in the UI, full content sent to the LLM.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
	AutocompleteItem,
	AutocompleteProvider,
	AutocompleteSuggestions,
} from "@earendil-works/pi-tui";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";

type SkillInfo = {
	name: string;
	description?: string;
	path: string;
};

function stripFrontmatter(content: string): string {
	if (!content.startsWith("---")) return content;
	const end = content.indexOf("\n---", 3);
	if (end === -1) return content;
	return content.slice(end + 4).trim();
}

function readSkill(skill: SkillInfo): string | undefined {
	try {
		const content = readFileSync(skill.path, "utf-8");
		const body = stripFrontmatter(content).trim();
		const baseDir = dirname(skill.path);
		return `References are relative to ${baseDir}.\n\n${body}`;
	} catch {
		return undefined;
	}
}

// parseSkillBlock() requires text to start with `^<skill name="..."`,
// so multiple skills get merged into one block.
function buildSkillBlock(
	skills: { info: SkillInfo; body: string }[],
): string {
	if (skills.length === 1) {
		const s = skills[0]!;
		return `<skill name="${s.info.name}" location="${s.info.path}">\n${s.body}\n</skill>`;
	}

	// Multiple skills: combine under a joint name, list all locations
	const names = skills.map((s) => s.info.name).join(", ");
	const bodies = skills
		.map((s) => `## ${s.info.name}\n\n${s.body}`)
		.join("\n\n");
	const locations = skills.map((s) => s.info.path).join(", ");
	return `<skill name="${names}" location="${locations}">\n${bodies}\n</skill>`;
}

// ── Autocomplete ──────────────────────────────────────────────────

function extractHashToken(textBeforeCursor: string): string | undefined {
	const match = textBeforeCursor.match(/(?:^|[ \t])#([^\s#]*)$/);
	return match?.[1];
}

function formatSkillItem(skill: SkillInfo): AutocompleteItem {
	return {
		value: `#${skill.name}`,
		label: `#${skill.name}`,
		description: skill.description ?? "",
	};
}

function filterSkills(skills: SkillInfo[], query: string): AutocompleteItem[] {
	const lower = query.toLowerCase().trim();
	return skills
		.filter((s) => !lower || s.name.toLowerCase().includes(lower))
		.slice(0, 20)
		.map(formatSkillItem);
}

function createSkillAutocompleteProvider(
	current: AutocompleteProvider,
	getSkills: () => SkillInfo[],
): AutocompleteProvider {
	return {
		async getSuggestions(
			lines,
			cursorLine,
			cursorCol,
			options,
		): Promise<AutocompleteSuggestions | null> {
			const currentLine = lines[cursorLine] ?? "";
			const textBeforeCursor = currentLine.slice(0, cursorCol);
			const token = extractHashToken(textBeforeCursor);
			if (token === undefined) {
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}

			const skills = getSkills();
			if (options.signal.aborted || skills.length === 0) {
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}

			const suggestions = filterSkills(skills, token);
			if (suggestions.length === 0) {
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}

			return {
				items: suggestions,
				prefix: `#${token}`,
			};
		},

		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
		},

		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			return (
				current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true
			);
		},
	};
}

// ── Extension ─────────────────────────────────────────────────────

const HASH_PATTERN = /(?:^|[\s([{"'])#([a-z0-9][a-z0-9-]*[a-z0-9]|[a-z0-9])\b/gm;

export default function (pi: ExtensionAPI): void {
	const skillsByName = new Map<string, SkillInfo>();
	const activatedSkills = new Set<string>();

	function loadSkills(): void {
		skillsByName.clear();
		for (const cmd of pi.getCommands()) {
			if (cmd.source !== "skill") continue;
			const name = cmd.name.replace(/^skill:/, "");
			skillsByName.set(name, {
				name,
				description: cmd.description,
				path: cmd.sourceInfo.path,
			});
		}
	}

	pi.on("session_start", (_event, ctx) => {
		loadSkills();
		activatedSkills.clear();
		ctx.ui.addAutocompleteProvider((current) =>
			createSkillAutocompleteProvider(current, () => [...skillsByName.values()]),
		);
	});

	pi.on("resources_discover", () => {
		loadSkills();
	});

	// Expand #skill-name tokens into a <skill> block the UI can collapse
	pi.on("input", (event) => {
		if (event.source === "extension") return { action: "continue" as const };

		const matches = [...event.text.matchAll(HASH_PATTERN)];
		if (matches.length === 0) return { action: "continue" as const };

		// Collect unique referenced skills
		const expanded: { info: SkillInfo; body: string }[] = [];
		const seen = new Set<string>();
		for (const m of matches) {
			const name = m[1];
			if (!name || seen.has(name)) continue;
			seen.add(name);
			if (activatedSkills.has(name)) continue;
			const skill = skillsByName.get(name);
			if (!skill) continue;
			const body = readSkill(skill);
			if (body) expanded.push({ info: skill, body });
		}

		if (expanded.length === 0) return { action: "continue" as const };

		const userMessage = event.text.trim();

		// Build the exact format parseSkillBlock() expects:
		// <skill ...>content</skill>\n\n<user message>
		for (const s of expanded) activatedSkills.add(s.info.name);

		const block = buildSkillBlock(expanded);
		const text = userMessage ? `${block}\n\n${userMessage}` : block;

		return { action: "transform" as const, text };
	});
}
