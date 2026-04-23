# ~/.pi/agent

Personal configuration for [pi](https://github.com/mariozechner/pi) — Mario Zechner's
terminal coding agent. Everything here is loaded from `~/.pi/agent` at startup:
settings, themes, custom extensions, skills, subagents, and the system prompt.

This is a snapshot of my setup. It's not meant to be reusable as-is — paths,
profile IDs, and enabled models are specific to my machine — but feel free to
copy anything useful.

## Layout

```
.
├── SYSTEM.md            # appended to pi's system prompt (grug voice, philosophy, tool rules)
├── APPEND_SYSTEM.md     # additional system prompt fragments
├── settings.json        # theme, default model/provider, enabled models, packages
├── models.json          # custom provider/model definitions (local llama.cpp, etc.)
├── web-tools.json       # browser profile config for the web-tools extension
├── themes/              # TUI color themes (catppuccin-macchiato)
├── agents/              # subagent definitions (explore, general)
├── skills/              # skill files loaded on demand by description match
├── extensions/          # TypeScript extensions loaded into the pi runtime
└── git/                 # git-related config
```

## Extensions

Each file in `extensions/` is a pi extension (see
[pi docs: extensions](https://github.com/mariozechner/pi/blob/main/docs/extensions.md)).
Files prefixed with numbers load in order.

| File | Purpose |
|------|---------|
| `00-box-editor.ts` | Custom bordered editor rendering |
| `01-minimal-footer.ts` | Strip footer on session shutdown |
| `cc-patch.ts` | Patch pi's Anthropic provider to use Claude subscription rate-limit bucket via OAuth token |
| `context.ts` | `/context` slash command — show loaded extensions, skills, context files, token usage |
| `todos.ts` | File-backed todo system under `.pi/todos` (markdown + JSON front matter) |
| `uv-guard.ts` | Block `pip`/`pipx` in bash tool, nudge toward `uv` |
| `whimsical.ts` | Whimsical thinking/working status messages |
| `fff/` | Fast file finder |
| `ls/` | Directory listing tool |
| `pi-upgrade/` | Upgrade pi and its peer dependencies together |
| `subagent/` | Subagent dispatch tool backing `agents/` |
| `web-tools/` | WebFetch + WebSearch with authenticated browser profile support |

## Agents

Defined in `agents/` and invoked via the `subagent` extension:

- **explore** — fast read-only agent for codebase discovery (haiku / gpt-5-mini)
- **general** — full-tool agent for delegated multi-step work

## Skills

Loaded on demand when pi matches the skill's description:

- **librarian** — cache remote git repos under `~/.cache/checkouts/<host>/<org>/<repo>`
- **pi-docs** — look up pi's own documentation when asked about pi internals

## System prompt

`SYSTEM.md` defines the "grug" voice, complexity-averse philosophy, and tool
usage rules (prefer `grep`/`find` over bash, edit vs write semantics, subagent
defaults, git safety). It is appended to pi's built-in system prompt.

## Related

- pi: https://github.com/mariozechner/pi
- grug brained developer: https://grugbrain.dev
