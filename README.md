# ~/.pi/agent

Personal configuration for [pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) — Mario Zechner's terminal coding agent.

This README describes the stable committed repository shape only. It intentionally omits ignored local state, uncommitted files, and volatile runtime/model settings.

## Layout

```text
.
├── SYSTEM.md             # main system prompt additions
├── settings.json         # pi runtime settings, packages, default model
├── models.json           # provider/model overrides and local llama.cpp model
├── themes/               # TUI theme
├── agents/               # subagent definitions
├── skills/               # skill files loaded on demand
└── extensions/           # TypeScript extensions loaded by pi
```

## Extensions

Each `.ts` file under `extensions/` is loaded by pi. Numbered files load first.

| File | Purpose |
|------|---------|
| `00-box-editor.ts` | Custom bordered editor rendering |
| `01-minimal-footer.ts` | Replace the default footer with a compact token/cwd/branch footer |
| `cc-patch.ts` | Patch Anthropic provider behavior for Claude subscription usage |
| `context.ts` | `/context` command showing loaded extensions, skills, context files, token usage |
| `disable-invocation.ts` | Removes rendered skill invocation instructions from the final system prompt |
| `todos.ts` | File-backed todo system under `.pi/todos` |
| `update.ts` | `/update` command that runs `pi update` then shuts down |
| `whimsical.ts` | Whimsical thinking/working status messages |
| `fff/` | FFF-powered `@` mention autocomplete |
| `subagent/` | Subagent dispatch tool backing `agents/` |
| `web-tools/` | WebFetch + WebSearch with authenticated browser profile support |

## Agents

Defined in `agents/` and invoked via the subagent extension:

- `explore` — fast read-only codebase discovery
- `general` — delegated multi-step work with tools

## Skills

Loaded on demand when pi matches the skill description:

- `librarian` — cache remote git repos under `~/.cache/checkouts/<host>/<org>/<repo>`
- `pi-docs` — look up pi documentation for pi internals

## System prompt

`SYSTEM.md` defines the voice, philosophy, tool rules, validation rules, and git safety behavior appended to pi's built-in system prompt.

## Related

- pi coding agent: https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent
- grug brained developer: https://grugbrain.dev
