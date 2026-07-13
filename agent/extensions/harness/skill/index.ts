/**
 * Skill tool extension (§4.5) — context-purist V1 carry-forward.
 *
 * Implements the "dedicated tool activation" pattern from the Agent Skills
 * spec instead of pi's built-in "read the SKILL.md" pattern: skill content
 * arrives as a tool result, which has far stronger adherence than injected
 * file content.
 *
 * CONTEXT-PURIST DESIGN: skills are fully invisible to the model. No catalog
 * in the system prompt (stripped here — folds in V1's disable-invocation.ts),
 * no catalog or name enum in the tool schema. Activation is user-driven only:
 * - `$name` / `/name` inline anywhere → hidden compressed directive injected
 *   via before_agent_start (input transform for steered/queued) → model calls
 *   the skill tool
 * - prose ("use the tdd skill") → model calls the tool; on a miss the error
 *   carries the fuzzy-ranked untruncated skill list as recovery
 * - no dedupe: repeated activations re-inject content on purpose, so skills
 *   survive compaction in long sessions
 *
 * Compaction contingency (§4.5): pi's SessionBeforeCompactResult only allows
 * cancel or full compaction replacement — the summarizer prompt is NOT
 * extendable, so active-skill recording falls back to plain V1 behavior
 * (noted in docs/pi-harness-v2-checklist.md Phase 3).
 */

import { dirname } from "node:path";
import type { ExtensionAPI, Skill, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { formatSkillsForPrompt } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions } from "@earendil-works/pi-tui";
import { fuzzyFilter } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { createTraceRenderer, type TraceInvocation, withTraceDetails } from "../ui/trace.ts";
import {
	availableSkillsBlock,
	buildDirective,
	extractSkillRefs,
	renderSkillContent,
	type SkillEntry,
	TRIGGER_CLASS,
} from "./core.ts";

interface SkillParams {
	name: string;
}

function skillTraceInvocation(args: SkillParams): TraceInvocation {
	return { action: "skill", target: args.name };
}

const traceRenderer = createTraceRenderer<SkillParams>({ invocation: skillTraceInvocation });

export function createSkillTool(skillsByName: ReadonlyMap<string, SkillEntry>): ToolDefinition<any, any, any> {
	function activateSkill(name: string): { title: string; text: string } {
		const skill = skillsByName.get(name);
		const names = [...skillsByName.keys()];
		if (!skill) {
			// Only on a miss does the catalog enter context, as recovery —
			// fuzzy-ranked against the attempted name, untruncated.
			throw new Error(`Unknown skill "${name}".\n${availableSkillsBlock(names, name)}`);
		}
		try {
			const text = renderSkillContent(skill);
			return { title: `Loaded skill: ${name}`, text };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(
				`Failed to load skill "${name}" from ${skill.filePath}: ${message}\n${availableSkillsBlock(names, name)}`,
			);
		}
	}

	return {
		name: "skill",
		label: "skill",
		description: [
			"Load a skill by exact name and return its full instructions: specialized guidance for specific tasks.",
			"Call it when the user explicitly requests a skill or an active skill explicitly directs invoking one.",
			"For active-skill handoffs, wait until the surrounding instruction is reached and its condition holds; mentions and examples are inert.",
			"Pass the name exactly as given — never an invented name or a filesystem path.",
		].join("\n"),
		parameters: Type.Object({
			name: Type.String({ description: "Name of the skill the user asked for" }),
		}),
		async execute(_toolCallId, params: SkillParams, _signal, onUpdate) {
			onUpdate?.({ content: [{ type: "text", text: "" }], details: withTraceDetails(undefined, "running") });
			const { title, text } = activateSkill(params.name);
			return {
				content: [{ type: "text", text }],
				details: withTraceDetails({ title, skill: params.name }, "success"),
			};
		},
		renderCall: traceRenderer.renderCall,
		renderResult: traceRenderer.renderResult,
	} as ToolDefinition<any, any, any>;
}

export default function skillTool(pi: ExtensionAPI): void {
	// ── State ──
	const skillsByName = new Map<string, SkillEntry>();

	// ── Helpers ──

	function setSkills(entries: SkillEntry[]): void {
		skillsByName.clear();
		for (const entry of entries) skillsByName.set(entry.name, entry);
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

	// ── Tool ──
	// Registered eagerly at load time: on /resume pi renders the restored chat
	// BEFORE emitting session_start (renderBeforeBind), and ToolExecution
	// captures the tool definition at construction. Lazy registration meant
	// resumed skill results lost their custom renderer and dumped raw content.
	pi.registerTool(createSkillTool(skillsByName));

	// ── Events ──

	// One handler, three jobs: sync the skill map with pi's authoritative
	// data, strip pi's skill catalog from the system prompt (no catalog
	// anywhere — §4.5 activation authority), and inject the skill-reference
	// directive as a hidden message (in LLM context, invisible in the TUI).
	// Scans the expanded prompt (post-template-expansion) so refs from
	// prompt templates are caught too.
	pi.on("before_agent_start", (event) => {
		refreshSkillsFromOptions(event.systemPromptOptions.skills);

		let systemPrompt: string | undefined;
		const skills = event.systemPromptOptions.skills ?? [];
		if (skills.length > 0) {
			const renderedSkillBlock = formatSkillsForPrompt(skills);
			if (renderedSkillBlock && event.systemPrompt.includes(renderedSkillBlock)) {
				systemPrompt = event.systemPrompt.replace(renderedSkillBlock, "");
			}
		}

		const refs = extractSkillRefs(event.prompt, [...skillsByName.keys()]);
		const message =
			refs.length > 0
				? {
						customType: "skill-ref-directive",
						content: buildDirective(refs),
						display: false as const,
					}
				: undefined;

		if (!systemPrompt && !message) return undefined;
		return { systemPrompt, message };
	});

	pi.on("session_start", (_event, ctx) => {
		refreshSkillsFromCommands();
		ctx.ui.addAutocompleteProvider((current) => createSkillRefProvider(current, () => [...skillsByName.values()]));
	});

	pi.on("resources_discover", () => {
		refreshSkillsFromCommands();
	});

	// Steered/queued messages skip before_agent_start, so detect skill refs
	// in the input handler and inline the directive for that path only.
	pi.on("input", (event) => {
		if (event.source === "extension") return { action: "continue" as const };
		if (!event.streamingBehavior) return { action: "continue" as const };

		const referenced = extractSkillRefs(event.text, [...skillsByName.keys()]);
		if (referenced.length === 0) return { action: "continue" as const };

		return {
			action: "transform" as const,
			text: `${event.text}\n\n${buildDirective(referenced)}`,
		};
	});
}

// ── Autocomplete ──────────────────────────────────────────────────

function createSkillRefProvider(current: AutocompleteProvider, getSkills: () => SkillEntry[]): AutocompleteProvider {
	const tokenPattern = new RegExp(`(?:^|\\s)(${TRIGGER_CLASS})([\\w-]*)$`);
	return {
		// The editor blacklists "/" as a custom trigger char, so only "$"
		// auto-pops. Inline "/name" completion still works via explicit Tab
		// (the editor calls the provider regardless of trigger chars then).
		triggerCharacters: ["$"],

		async getSuggestions(lines, cursorLine, cursorCol, options): Promise<AutocompleteSuggestions | null> {
			const line = lines[cursorLine] ?? "";
			const beforeCursor = line.slice(0, cursorCol);
			// The editor only triggers after whitespace/line-start (its own
			// pattern from triggerCharacters), so the boundary here mirrors that.
			const match = beforeCursor.match(tokenPattern);
			if (!match) {
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}

			const trigger = match[1]!;
			const query = match[2]!;
			// "/" at column 0 of line 0 is the built-in command menu — keep it.
			// Only that exact position: the built-in provider requires the line
			// to start with "/", so inline or indented "/" tokens are ours.
			const tokenStart = cursorCol - trigger.length - query.length;
			if (trigger === "/" && cursorLine === 0 && tokenStart === 0) {
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}
			const items: AutocompleteItem[] = fuzzyFilter(getSkills(), query, (s) => s.name).map((s) => ({
				value: `${trigger}${s.name}`,
				label: `${trigger}${s.name}`,
				description: s.description,
			}));

			if (items.length === 0) {
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}
			return { items, prefix: `${trigger}${query}` };
		},

		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
		},

		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
		},
	};
}
