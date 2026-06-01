# ~/.pi/agent

Personal config for [pi](https://github.com/earendil-works/pi-mono/tree/main/packages/coding-agent), a terminal coding agent by Mario Zechner.

Covers the committed repo shape. Ignores local state, uncommitted files, and runtime/model settings.

## Layout

```text
.
├── SYSTEM.md             # main system prompt: voice, workflow, validation, git safety
├── AGENTS.md             # project instructions for subagents (issue tracker, triage, domain docs)
├── settings.json         # pi runtime settings, packages, default model
├── models.json           # provider/model overrides and local llama.cpp model
├── cursor-sdk.json       # Cursor SDK provider config
├── cursor-sdk-model-list.json
├── docs/                 # agent-facing documentation (issue tracker, triage labels, domain docs)
├── themes/               # TUI theme (catppuccin-macchiato)
├── agents/               # subagent definitions
├── skills/               # skill files loaded on demand
├── extensions/           # TypeScript extensions loaded by pi
├── git/                  # git-related config (.gitignore only)
└── npm/                  # npm-related config (.gitignore only)
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
- `thermo-nuclear-code-quality-review-subagent` — strict maintainability audit (abstraction, file size, spaghetti); invoked by thermos
- `thermo-nuclear-review-subagent` — security/correctness audit scoped to diff (bugs, breaking changes, devex); invoked by thermos

## Skills

Loaded on demand by skill match:

- `diagnose` — disciplined diagnosis loop for hard bugs and performance regressions
- `grill-with-docs` — stress-test a plan against the domain model, update CONTEXT.md / ADRs
- `handoff` — compact conversation into a handoff document for another agent
- `improve-codebase-architecture` — find deepening opportunities to improve testability and AI-navigability
- `librarian` — cache remote git repos under `~/.cache/checkouts/<host>/<org>/<repo>`
- `pi-docs` — pi internals documentation lookup
- `prototype` — build throwaway prototypes (terminal state-logic or UI variations)
- `setup-matt-pocock-skills` — scaffold per-repo issue tracker, triage labels, domain docs
- `sync-pocock-skills` — sync upstream Matt Pocock skills, apply pi-specific patches
- `tdd` — test-driven development with red-green-refactor loop
- `thermo-nuclear-code-quality-review` — extremely strict maintainability review
- `thermo-nuclear-review` — comprehensive security and correctness audit of branch changes
- `thermos` — launch both thermo-nuclear subagents in parallel and synthesize findings
- `to-issues` — break a plan/spec/PRD into independently-grabbable issues
- `to-prd` — turn conversation context into a PRD and publish to issue tracker
- `triage` — move issues through a triage state machine
- `zoom-out` — go up a layer of abstraction, map relevant modules and callers

## System prompt

`SYSTEM.md` — voice, philosophy, tool rules, validation, git safety. Appended to pi's built-in system prompt.

## Related

- [pi coding agent](https://github.com/earendil-works/pi-mono/tree/main/packages/coding-agent)
- [grug brained developer](https://grugbrain.dev)
