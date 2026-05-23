# ~/.pi/agent

Personal config for [pi](https://github.com/earendil-works/pi-mono/tree/main/packages/coding-agent), a terminal coding agent by Mario Zechner.

Covers the committed repo shape. Ignores local state, uncommitted files, and runtime/model settings.

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

Each `.ts` file under `extensions/` is loaded by pi. Subdirectories with an `index.ts` load as package extensions.

| File | Purpose |
|------|---------|
| `prompt-box.ts` | Bordered prompt editor with model/thinking header and token/cwd/branch footer |
| `bash.ts` | Local non-interactive shell command tool with truncation and timeout support |
| `cc-patch.ts` | Patch Anthropic provider behavior for Claude subscription usage |
| `context.ts` | `/context` command showing loaded extensions, skills, context files, token usage |
| `disable-invocation.ts` | Removes rendered skill invocation instructions from the final system prompt |
| `edit.ts` | Multi-edit exact text replacement tool with atomic writes and unified diff output |
| `ghostty.ts` | Ghostty terminal control tool — list tabs, send text, focus |
| `inline-skills.ts` | `#` autocomplete for skills; expands to collapsible skill blocks on submit |
| `read.ts` | Local text file/directory reader with binary detection and truncation |
| `session-name.ts` | `set_session_name` tool for naming sessions for later retrieval |
| `todos.ts` | File-backed todo system under `.pi/todos` |
| `whimsical.ts` | Whimsical thinking/working status messages |
| `write.ts` | Complete file writer that creates parent directories and preserves BOM |
| `diff-review/` | `/diffs` command — browser UI to review working-tree diff and send line comments to pi |
| `subagent/` | Subagent dispatch tool backing `agents/` |

## Agents

In `agents/`, invoked through the subagent extension:

- `explore` — fast read-only codebase discovery
- `general` — delegated multi-step work with tools

## Skills

Loaded on demand by skill match:

- `librarian` — cache remote git repos under `~/.cache/checkouts/<host>/<org>/<repo>`
- `pi-docs` — pi internals documentation lookup

## System prompt

`SYSTEM.md` — voice, philosophy, tool rules, validation, git safety. Appended to pi's built-in system prompt.

## Related

- [pi coding agent](https://github.com/earendil-works/pi-mono/tree/main/packages/coding-agent)
- [grug brained developer](https://grugbrain.dev)
