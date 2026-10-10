import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";
import { fuzzyFilter } from "@earendil-works/pi-tui";

export const MIN_SKILL_QUERY_LENGTH = 2;

export const MAX_SUGGESTIONS = 15;

const SKILL_VALUE_PREFIX = "/skill:";

export interface SlashCommandLike {
  name: string;
  description?: string;
  source?: string;
}

export interface SkillSuggestion {
  name: string;
  label: string;
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
        return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
      }

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
