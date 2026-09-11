# Prose

No em-dashes anywhere in prose. Where a sentence reaches for one, rewrite it instead with a comma, colon, period, parentheses, or a conjunction, whichever the sentence actually wants; never do a blind character substitution.

# Package policy (npm)

- Use `pnpm` for all package operations. Never run npm, yarn, or bun install.
- Before adding a dependency or bumping a version, check its publish date (e.g. `pnpm view <pkg> time --json`).
- Do not install packages whose latest publish is newer than 5 days without asking the user. Explicit user approval overrides this rule.
- If an existing lockfile is present, prefer `pnpm install --frozen-lockfile`.
