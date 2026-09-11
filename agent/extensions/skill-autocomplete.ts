/**
 * Inline skill autocomplete for mid-line slash tokens: with `use /subag`
 * in the editor, Tab (or any keystroke while the popup is open) suggests
 * `/skill:subagent`, `/skill:tdd`, etc.
 *
 * The provider never fires at message start: the built-in slash menu owns
 * that flow and already lists skills. Mid-line suggestions appear on Tab
 * because the editor only auto-triggers on `/` at message start and on
 * `@`/`#` tokens; that gate is editor behavior, not a provider choice.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";
import { fuzzyFilter } from "@earendil-works/pi-tui";

/** Minimum query length after the `/` before skill suggestions appear. */
export const MIN_SKILL_QUERY_LENGTH = 2;

/** Cap on how many suggestions are shown at once. */
export const MAX_SUGGESTIONS = 15;

/**
 * Marker that prefixes every value we produce. The built-in slash-menu
 * items carry the bare command name (e.g. "skill:subagent"), so the marker
 * discriminates our items from those. It is a heuristic, not an invariant:
 * built-in argument completions are arbitrary extension-supplied strings
 * and could in principle collide with it.
 */
const SKILL_VALUE_PREFIX = "/skill:";

/** Minimal shape of the slash-command entries pi exposes via getCommands(). */
export interface SlashCommandLike {
  /** Invokable name without the leading slash, e.g. "skill:subagent". */
  name: string;
  description?: string;
  source?: string;
}

/** A skill ready for display, with the "skill:" prefix stripped. */
export interface SkillSuggestion {
  /** Bare skill name, e.g. "subagent". */
  name: string;
  /** Text shown in the completion list. */
  label: string;
  /** Text inserted into the editor on accept. */
  value: string;
  description?: string;
}

/**
 * Extracts the skill query token from the text before the cursor, or
 * undefined when the cursor is not inside a mid-line slash token with at
 * least MIN_SKILL_QUERY_LENGTH characters. The slash must be preceded by
 * real content plus whitespace, so message-start commands (including
 * indented ones) and `a/b` never trigger.
 */
export const extractSkillToken = (textBeforeCursor: string): string | undefined => {
  const match = textBeforeCursor.match(/\S[ \t]+\/([^\s]*)$/);
  const token = match?.[1];

  if (token === undefined || token.length < MIN_SKILL_QUERY_LENGTH) {
    return undefined;
  }

  return token;
};

/** Filters getCommands() entries down to unique skills, user scope first. */
export const collectSkillCommands = (commands: readonly SlashCommandLike[]): SkillSuggestion[] => {
  const seen = new Set<string>();
  const skills: SkillSuggestion[] = [];

  for (const command of commands) {
    if (command.source !== "skill") {
      continue;
    }

    const name = command.name.replace(/^skill:/, "");

    if (seen.has(name)) {
      continue;
    }

    seen.add(name);
    skills.push({
      name,
      label: `/skill:${name}`,
      value: `/skill:${name}`,
      ...(command.description !== undefined && { description: command.description }),
    });
  }

  return skills;
};

/** Fuzzy-matches skills against the query, capped at MAX_SUGGESTIONS. */
export const filterSkillSuggestions = (
  skills: readonly SkillSuggestion[],
  query: string,
): AutocompleteItem[] => {
  const normalizedQuery = query.replace(/^skill:/, "");

  return fuzzyFilter([...skills], normalizedQuery, (skill) => `${skill.name} skill`)
    .slice(0, MAX_SUGGESTIONS)
    .map((skill) => ({
      value: skill.value,
      label: skill.label,
      ...(skill.description !== undefined && { description: skill.description }),
    }));
};

/**
 * Wraps the built-in autocomplete provider: mid-line skill suggestions when
 * the cursor is in a `... /sk...` token, otherwise the built-in behavior.
 */
export const createSkillAutocompleteProvider = (
  current: AutocompleteProvider,
  getSkills: () => SkillSuggestion[],
): AutocompleteProvider => {
  const provider: AutocompleteProvider = {
    async getSuggestions(lines, cursorLine, cursorCol, options) {
      const currentLine = lines[cursorLine] ?? "";
      const token = extractSkillToken(currentLine.slice(0, cursorCol));

      if (token === undefined) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }

      const items = filterSkillSuggestions(getSkills(), token);

      if (items.length === 0) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }

      return {
        items,
        prefix: `/${token}`,
      };
    },

    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      if (!item.value.startsWith(SKILL_VALUE_PREFIX)) {
        // Built-in item (slash menu, paths, arguments): let the built-in
        // provider apply it. Its slash-prepend branch only fires for
        // line-start prefixes, so delegating here is what keeps
        // message-start completions correct.
        return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
      }

      // Our item: replace the slash token with the full value. Delegating
      // would also insert verbatim today: mid-line slash prefixes route
      // through the built-in's argument branch, not its slash-prepend
      // branch. That routing is a built-in implementation detail, not
      // a stable contract, so own the insertion here.
      const currentLine = lines[cursorLine] ?? "";
      const tokenStart = Math.max(0, cursorCol - prefix.length);
      const before = currentLine.slice(0, tokenStart);
      const after = currentLine.slice(cursorCol);
      const nextLine = `${before}${item.value}${after}`;
      const nextLines = [...lines];
      nextLines[cursorLine] = nextLine;

      return {
        lines: nextLines,
        cursorLine,
        cursorCol: tokenStart + item.value.length,
      };
    },

    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
    },
  };

  if (current.triggerCharacters !== undefined) {
    provider.triggerCharacters = current.triggerCharacters;
  }

  return provider;
};

/** Registers the skill autocomplete provider on every session start. */
export default function skillAutocomplete(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    const getSkills = (): SkillSuggestion[] => {
      try {
        return collectSkillCommands(pi.getCommands());
      } catch (error) {
        console.warn("skill-autocomplete: failed to list skills:", error);

        return [];
      }
    };

    ctx.ui.addAutocompleteProvider((current) =>
      createSkillAutocompleteProvider(current, getSkills),
    );
  });
}
