import { Marked } from "@earendil-works/pi-tui";

function normalizeSource(source: string) {
  const offsets: number[] = [];
  let text = "";

  for (let index = 0; index < source.length; index++) {
    offsets.push(index);
    text += source[index] === "\r" ? "\n" : source[index];

    if (source[index] === "\r" && source[index + 1] === "\n") index++;
  }

  offsets.push(source.length);

  return { text, offsets };
}

export function protectLiterals(source: string) {
  const { text, offsets } = normalizeSource(source);
  const markdown = new Marked();
  const tokenizer = new markdown.Tokenizer();

  new markdown.Lexer({ tokenizer });

  let prefix = "⟦FRIENDLY_LITERAL_";

  while (source.includes(prefix)) prefix = `_${prefix}`;

  const literals: string[] = [];
  const parts: string[] = [];
  let position = 0;

  while (position < text.length) {
    const remaining = text.slice(position);
    let literal: string | undefined;

    if (position === 0 || text[position - 1] === "\n") {
      literal = tokenizer.fences(remaining)?.raw;

      if (literal && remaining[literal.length] === "\n") literal += "\n";

      literal ??= remaining.match(/^ {0,3}>[^\n]*(?:\n|$)/)?.[0];
    }

    literal ??= tokenizer.codespan(remaining)?.raw;

    if (!/\w/.test(text[position - 1] ?? "")) {
      literal ??= remaining.match(/^"(?:\\.|[^"\\])*"/)?.[0];
      literal ??= remaining.match(/^'(?:\\.|[^'\\\n])*'(?!\w)/)?.[0];
    }

    const word = remaining.match(/^[^\s<>"'`]+/)?.[0];

    if (!literal && word && (word.includes("/") || word.includes("\\"))) literal = word;

    const length = literal?.length ?? word?.length ?? 1;
    const original = source.slice(offsets[position], offsets[position + length]);

    if (literal) {
      parts.push(`${prefix}${literals.length}⟧`);
      literals.push(original);
    } else {
      parts.push(original);
    }

    position += length;
  }

  return {
    text: parts.join(""),
    tokens: literals.map((_literal, index) => `${prefix}${index}⟧`),
    restore(rewritten: string): string | undefined {
      const segments = rewritten.split(prefix);

      if (segments.length !== literals.length + 1) return undefined;

      let restored = segments[0] ?? "";

      for (const [index, literal] of literals.entries()) {
        const marker = `${index}⟧`;
        const segment = segments[index + 1];

        if (!segment?.startsWith(marker)) return undefined;

        restored += literal + segment.slice(marker.length);
      }

      return restored;
    },
  };
}
