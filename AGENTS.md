# Pi repository instructions

Personal configuration and extension code for Pi's constrained agent tooling, model profiles, specialist agents, skills, and terminal UI.

## Essentials

- Use `pnpm`.
- There is no build step.
- Run `pnpm typecheck` for non-mutating type checking.
- Run `pnpm test` for the test suite.
- `pnpm check` runs Biome with auto-fixes and then TypeScript; it may modify files.

## Agent skills

### Issue tracker

GitHub Issues in `sndrgrdn/pi`; pull requests are not a triage surface. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context. See `docs/agents/domain.md`.
