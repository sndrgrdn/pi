/**
 * Skill tool extension.
 *
 * Implements the "dedicated tool activation" pattern from the Agent Skills
 * spec (https://agentskills.io/client-implementation/adding-skills-support#step-4-activate-skills)
 * instead of pi's built-in "read the SKILL.md" pattern. Many open-weight
 * models are heavily optimized for tool calling and have near-zero adherence
 * to file-read skill activation; a dedicated tool fixes that.
 *
 * CONTEXT-PURIST DESIGN: skills are fully invisible to the model. No catalog
 * in the system prompt (disable-invocation.ts strips it), no catalog or name
 * enum in the tool schema. Activation is user-driven only:
 * - `$skill-name` (with `$` autocomplete) → hidden directive injected via
 *   before_agent_start → model calls the skill tool → content arrives as a
 *   tool result (much stronger adherence than injected file content)
 * - prose ("use the tdd skill") → model calls the tool; on a bad name the
 *   error response lists valid names as recovery
 * - no dedupe: repeated activations re-inject content on purpose, so skills
 *   survive compaction/summarization in long sessions
 * - `disable-model-invocation` frontmatter is ignored: every skill is
 *   invisible until the user asks, making the flag redundant
 */
import type { ExtensionAPI, Skill } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type {
	AutocompleteItem,
	AutocompleteProvider,
	AutocompleteSuggestions,
} from "@earendil-works/pi-tui";
import { fuzzyFilter, Text } from "@earendil-works/pi-tui";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const MAX_LISTED_FILES = 20;
const SKIP_DIRS = new Set(["node_modules", "__pycache__"]);

// ── Skill content ─────────────────────────────────────────────────

function stripFrontmatter(content: string): string {
	if (!content.startsWith("---")) return content;
	const end = content.indexOf("\n---", 3);
	if (end === -1) return content;
	return content.slice(end + 4).trim();
}

function listSkillFiles(baseDir: string): { files: string[]; truncated: boolean } {
	const files: string[] = [];
	let truncated = false;
	const walk = (dir: string): void => {
		if (truncated) return;
		let entries;
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

type SkillEntry = {
	name: string;
	description: string;
	filePath: string;
	baseDir: string;
};

function renderSkillContent(skill: SkillEntry): string {
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

// ── Extension ─────────────────────────────────────────────────────

export default function (pi: ExtensionAPI): void {
	// ── State ──
	const skillsByName = new Map<string, SkillEntry>();
	let toolRegistered = false;

	// ── Helpers ──

	// The skill map is the token grammar: build the matcher from the loaded
	// names so every match is a valid skill by construction. Longest-first
	// alternation + lookahead keep `$tdd` from matching inside `$tdd-review`.
	function skillRefPattern(): RegExp | null {
		if (skillsByName.size === 0) return null;
		const alternatives = [...skillsByName.keys()]
			.sort((a, b) => b.length - a.length)
			.map((name) => name.replace(/[\\^$.*+?()[\]{}|-]/g, "\\$&"))
			.join("|");
		return new RegExp(`(?<=^|[\\s([{"'\`])\\$(${alternatives})(?![\\w-])`, "gm");
	}
	function setSkills(entries: SkillEntry[]): void {
		skillsByName.clear();
		for (const entry of entries) skillsByName.set(entry.name, entry);
		registerSkillTool();
	}

	// Fallback discovery via /skill:name commands (available at session_start).
	function refreshSkillsFromCommands(): void {
		setSkills(
			pi
				.getCommands()
				.filter((cmd) => cmd.source === "skill")
				.map((cmd) => ({
					name: cmd.name.replace(/^skill:/, ""),
					description: cmd.description ?? "",
					filePath: cmd.sourceInfo.path,
					baseDir: dirname(cmd.sourceInfo.path),
				})),
		);
	}

	// Authoritative refresh from the structured system-prompt options.
	function refreshSkillsFromOptions(skills: readonly Skill[] | undefined): void {
		if (!skills) return;
		setSkills(
			skills.map((skill) => ({
				name: skill.name,
				description: skill.description,
				filePath: skill.filePath,
				baseDir: skill.baseDir,
			})),
		);
	}

	// Names only: the user already picked the skill, so recovery is spelling
	// correction, not semantic selection — descriptions would be wasted tokens.
	function availableSkillsBlock(): string {
		if (skillsByName.size === 0) return "<available_skills>(none)</available_skills>";
		const lines = ["<available_skills>"];
		for (const name of skillsByName.keys()) lines.push(`  <skill>${name}</skill>`);
		lines.push("</available_skills>");
		return lines.join("\n");
	}

	function activateSkill(
		name: string,
		visited: Set<string> = new Set(),
	): { title: string; text: string } {
		const skill = skillsByName.get(name);
		if (!skill) {
			// Only on a miss does the catalog enter context, as recovery.
			throw new Error(`Unknown skill "${name}".\n${availableSkillsBlock()}`);
		}
		try {
			let text = renderSkillContent(skill);

			// Detect $-refs inside the skill body and append a directive so the
			// model loads them too — same mechanism as user-input $-refs.
			// Guard against circular references with a visited set.
			visited.add(name);
			const pattern = skillRefPattern();
			if (pattern) {
				const refs = [...new Set([...text.matchAll(pattern)].map((m) => m[1]!))]
					.filter((ref) => !visited.has(ref));
				if (refs.length > 0) {
					text += `\n\n${buildDirective(refs)}`;
				}
			}

			return { title: `Loaded skill: ${name}`, text };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(
				`Failed to load skill "${name}" from ${skill.filePath}: ${message}\n${availableSkillsBlock()}`,
			);
		}
	}

	function buildDirective(names: string[]): string {
		return [
			"<skill_directive>",
			"The user referenced skills with $. Call the skill tool once per skill named below, before planning, answering, editing files, or running commands, then follow the returned instructions.",
			...names.map((name) => `<skill>${name}</skill>`),
			"</skill_directive>",
		].join("\n");
	}

	// ── Tool ──
	function registerSkillTool(): void {
		if (toolRegistered || skillsByName.size === 0) return;
		toolRegistered = true;

		pi.registerTool({
			name: "skill",
			label: "Skill",
			description: [
				"Load a skill by exact name and return its full instructions: specialized guidance for specific tasks.",
				"Call it only when explicitly asked to load or use a skill — never on your own initiative.",
				"Pass the name exactly as given — never an invented name or a filesystem path.",
			].join("\n"),
			parameters: Type.Object({
				name: Type.String({ description: "Name of the skill the user asked for" }),
			}),
			async execute(_toolCallId, params) {
				const { title, text } = activateSkill(params.name);
				return {
					content: [{ type: "text", text }],
					details: { title, skill: params.name },
				};
			},
			renderCall(args, theme, context) {
				const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
				const name = (args as { name?: string })?.name ?? "";
				const skill = skillsByName.get(name);
				let line = `${theme.fg("toolTitle", theme.bold("skill"))} ${theme.fg("accent", name)}`;
				if (skill) line += ` ${theme.fg("muted", skill.filePath)}`;
				text.setText(line);
				return text;
			},
			renderResult(result, options, theme, context) {
				const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
				if (!options.expanded && !context.isError) {
					text.setText("");
					return text;
				}
				const output =
					result.content.find((c): c is { type: "text"; text: string } => c.type === "text")
						?.text ?? "";
				const lines = output.split("\n");
				text.setText(
					`\n${lines.map((line) => theme.fg("toolOutput", line)).join("\n")}`,
				);
				return text;
			},
		});
	}

	// ── Events ──

	// Keep the skill map in sync with pi's authoritative skill data, and
	// inject the pending $-reference directive as a hidden message (in LLM
	// context, invisible in the TUI — the tool call is the visible signal).
	// Scans the expanded prompt (post-template-expansion) so $-refs from
	// prompt templates are caught too.
	pi.on("before_agent_start", (event) => {
		refreshSkillsFromOptions(event.systemPromptOptions.skills);

		const pattern = skillRefPattern();
		const refs = pattern
			? [...new Set([...event.prompt.matchAll(pattern)].map((m) => m[1]!))]
			: [];

		if (refs.length === 0) return undefined;
		const directive = buildDirective(refs);
		return {
			message: {
				customType: "skill-ref-directive",
				content: directive,
				display: false,
			},
		};
	});

	pi.on("session_start", (_event, ctx) => {
		refreshSkillsFromCommands();
		ctx.ui.addAutocompleteProvider((current) =>
			createDollarProvider(current, () => [...skillsByName.values()]),
		);
	});

	pi.on("resources_discover", () => {
		refreshSkillsFromCommands();
	});

	// Steered/queued messages skip before_agent_start, so detect $-refs
	// in the input handler and inline the directive for that path only.
	pi.on("input", (event) => {
		if (event.source === "extension") return { action: "continue" as const };
		if (!event.streamingBehavior) return { action: "continue" as const };

		const pattern = skillRefPattern();
		if (!pattern) return { action: "continue" as const };

		const referenced = [...new Set([...event.text.matchAll(pattern)].map((m) => m[1]!))];
		if (referenced.length === 0) return { action: "continue" as const };

		return {
			action: "transform" as const,
			text: `${event.text}\n\n${buildDirective(referenced)}`,
		};
	});
}

// ── Autocomplete ──────────────────────────────────────────────────

function createDollarProvider(
	current: AutocompleteProvider,
	getSkills: () => SkillEntry[],
): AutocompleteProvider {
	return {
		triggerCharacters: ["$"],

		async getSuggestions(
			lines,
			cursorLine,
			cursorCol,
			options,
		): Promise<AutocompleteSuggestions | null> {
			const line = lines[cursorLine] ?? "";
			const beforeCursor = line.slice(0, cursorCol);
			// The editor only triggers after whitespace/line-start (its own
			// pattern from triggerCharacters), so the boundary here mirrors that.
			const match = beforeCursor.match(/(?:^|\s)\$([\w-]*)$/);
			if (!match) {
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}

			const query = match[1] ?? "";
			const items: AutocompleteItem[] = fuzzyFilter(getSkills(), query, (s) => s.name)
				.slice(0, 20)
				.map((s) => ({
					value: `$${s.name}`,
					label: `$${s.name}`,
					description: s.description,
				}));

			if (items.length === 0) {
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}
			return { items, prefix: `$${match[1] ?? ""}` };
		},

		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
		},

		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
		},
	};
}
