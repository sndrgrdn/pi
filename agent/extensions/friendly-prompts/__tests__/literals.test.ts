import { describe, expect, it } from "vitest";
import { protectLiterals } from "../literals.ts";

describe("literal preservation", () => {
  const literals = [
    "`pnpm test`",
    "``a `nested` command``",
    "```ts\nthrow new Error('idiot');\n```\n",
    "~~~\nstop fucking up\n~~~\n",
    "```\nunclosed fence\n",
    "> you are an idiot\n> quoted feedback\n",
    '"you are an idiot"',
    "'you are an idiot'",
    '"escaped \\" quotation"',
    "https://example.com/path?x=1&y=2",
    "C:\\Users\\test\\file.ts",
    "/tmp/tests.ts",
    "./tests/spec.ts",
    "../tests/spec.ts",
    "~/tests/spec.ts",
  ];

  it.each(literals)("round-trips %j byte for byte", (literal) => {
    const original = `Fix this, idiot.\n${literal}`;
    const protectedInput = protectLiterals(original);

    expect(protectedInput.text).not.toContain(literal);
    expect(protectedInput.restore(protectedInput.text)).toBe(original);
    expect(protectedInput.restore(protectedInput.text.replace("idiot", "please"))).toBe(
      original.replace("idiot", "please"),
    );
  });

  it.each(["src/stupid.ts", "src/nested/component.ts", "lib\\components\\test.ts"])(
    "protects the complete relative path %s",
    (path) => {
      const original = `Fix ${path} now, idiot`;
      const protectedInput = protectLiterals(original);

      expect(protectedInput.text).toBe("Fix ⟦FRIENDLY_LITERAL_0⟧ now, idiot");
      expect(protectedInput.restore(protectedInput.text.replace("idiot", "please"))).toBe(
        `Fix ${path} now, please`,
      );
    },
  );

  it.each([
    ["```", "````"],
    ["~~~~", "~~~~~~"],
  ])("ends a %s code block at a longer %s fence", (opening, closing) => {
    const code = `${opening}js\nconst n = 1;\n${closing}\n`;
    const protectedInput = protectLiterals(`${code}Fix this, idiot`);

    expect(protectedInput.text).toBe("⟦FRIENDLY_LITERAL_0⟧Fix this, idiot");
    expect(protectedInput.restore(protectedInput.text.replace("idiot", "please"))).toBe(
      `${code}Fix this, please`,
    );
  });

  it.each([
    ["````", "```"],
    ["~~~~", "~~~"],
    ["```", "~~~"],
  ])("does not close a %s code block with %s", (opening, closing) => {
    const code = `${opening}js\nconst n = 1;\n${closing}\nstill code`;
    const protectedInput = protectLiterals(code);

    expect(protectedInput.text).toBe("⟦FRIENDLY_LITERAL_0⟧");
    expect(protectedInput.restore(protectedInput.text)).toBe(code);
  });

  it.each(["\n", "\r\n", "\r"])("preserves original line endings %j", (newline) => {
    const code = `\`\`\`ts${newline}const text = "友好 😡";${newline}\`\`\`\`${newline}`;
    const original = `Before${newline}${code}Fix this, idiot${newline}`;
    const protectedInput = protectLiterals(original);

    expect(protectedInput.text).toBe(
      `Before${newline}⟦FRIENDLY_LITERAL_0⟧Fix this, idiot${newline}`,
    );
    expect(protectedInput.restore(protectedInput.text.replace("idiot", "please"))).toBe(
      `Before${newline}${code}Fix this, please${newline}`,
    );
  });

  it("preserves nested code and quoted literals without overlapping replacements", () => {
    const original = 'Fix `print("idiot")` and "use `this`", idiot';
    const protectedInput = protectLiterals(original);

    expect(protectedInput.text).toBe("Fix ⟦FRIENDLY_LITERAL_0⟧ and ⟦FRIENDLY_LITERAL_1⟧, idiot");
    expect(protectedInput.restore(protectedInput.text.replace("idiot", "please"))).toBe(
      'Fix `print("idiot")` and "use `this`", please',
    );
  });

  it("does not mistake contractions for quoted literals", () => {
    expect(protectLiterals("Don't change this, you're wrong").text).toBe(
      "Don't change this, you're wrong",
    );
  });

  it("handles marker-like input without collisions", () => {
    const original = "⟦FRIENDLY_LITERAL_0⟧ fix `a`";
    const protectedInput = protectLiterals(original);

    expect(protectedInput.restore(protectedInput.text)).toBe(original);
  });

  it("rejects missing, repeated, reordered, and unknown markers", () => {
    const protectedInput = protectLiterals("fix `a` and `b`");

    for (const candidate of [
      "fix ⟦FRIENDLY_LITERAL_0⟧",
      "fix ⟦FRIENDLY_LITERAL_0⟧ ⟦FRIENDLY_LITERAL_0⟧",
      "fix ⟦FRIENDLY_LITERAL_1⟧ ⟦FRIENDLY_LITERAL_0⟧",
      "fix ⟦FRIENDLY_LITERAL_0⟧ ⟦FRIENDLY_LITERAL_2⟧",
      "fix ⟦FRIENDLY_LITERAL_0⟧ ⟦FRIENDLY_LITERAL_1⟧ ⟦FRIENDLY_LITERAL_UNKNOWN⟧",
    ]) {
      expect(protectedInput.restore(candidate)).toBeUndefined();
    }
  });
});
