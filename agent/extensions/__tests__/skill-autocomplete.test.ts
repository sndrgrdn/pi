import { CombinedAutocompleteProvider } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { collectSkillCommands, createSkillAutocompleteProvider } from "../skill-autocomplete.ts";

const skills = collectSkillCommands([{ name: "skill:subagent", source: "skill" }]);

const options = () => ({ signal: new AbortController().signal });

function createBuiltinProvider() {
  return new CombinedAutocompleteProvider(
    [
      { name: "skill:subagent" },
      {
        name: "pick",
        getArgumentCompletions: () => [{ value: '/skill:subagent"', label: "subagent/" }],
      },
    ],
    process.cwd(),
  );
}

describe("skill autocomplete ownership", () => {
  it("inserts owned suggestions while preserving surrounding text and the cursor", async () => {
    const provider = createSkillAutocompleteProvider(createBuiltinProvider(), () => skills);
    const lines = ["First line", "Use /sub after"];
    const cursorCol = "Use /sub".length;
    const suggestions = await provider.getSuggestions(lines, 1, cursorCol, options());
    const item = suggestions?.items[0];

    if (!suggestions || !item) throw new Error("Expected a skill suggestion");

    expect(provider.applyCompletion(lines, 1, cursorCol, item, suggestions.prefix)).toEqual({
      lines: ["First line", "Use /skill:subagent after"],
      cursorLine: 1,
      cursorCol: "Use /skill:subagent".length,
    });
  });

  it("delegates builtin argument suggestions with skill-prefixed values", async () => {
    const provider = createSkillAutocompleteProvider(createBuiltinProvider(), () => []);
    const line = "/pick /sub";
    const lines = [line];
    const suggestions = await provider.getSuggestions(lines, 0, line.length, options());
    const item = suggestions?.items[0];

    if (!suggestions || !item) throw new Error("Expected a builtin argument suggestion");

    expect(provider.applyCompletion(lines, 0, line.length, item, suggestions.prefix)).toEqual({
      lines: ['/pick /skill:subagent"'],
      cursorLine: 0,
      cursorCol: "/pick /skill:subagent".length,
    });
  });

  it("delegates message-start skill suggestions to the builtin provider", async () => {
    const provider = createSkillAutocompleteProvider(createBuiltinProvider(), () => skills);
    const lines = ["/sub"];
    const suggestions = await provider.getSuggestions(lines, 0, 4, options());
    const item = suggestions?.items[0];

    if (!suggestions || !item) throw new Error("Expected a builtin skill suggestion");

    expect(provider.applyCompletion(lines, 0, 4, item, suggestions.prefix)).toEqual({
      lines: ["/skill:subagent "],
      cursorLine: 0,
      cursorCol: "/skill:subagent ".length,
    });
  });
});
