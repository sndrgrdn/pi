# ~/.pi

Personal configuration and extension code for [pi](https://github.com/earendil-works/pi-mono/tree/main/packages/coding-agent), a terminal coding agent by Mario Zechner.

This repository contains a constrained main-agent tool surface, mode-based model profiles, delegated specialist agents, local skills, and custom terminal UI. The Git repository lives at `~/.pi`; Pi's runtime configuration remains under `~/.pi/agent`, where Pi discovers it.

## Layout

```text
~/.pi/
├── AGENTS.md                 # repository-level agent instructions
├── CONTEXT.md                # canonical extension terminology
├── README.md
├── docs/agents/              # issue tracker, triage, and domain guidance
└── agent/                    # Pi's global agent directory
    ├── SYSTEM.md             # main system prompt
    ├── APPEND_SYSTEM.md      # local, ignored prompt additions
    ├── settings.json         # Pi settings and package configuration
    ├── models.json           # provider and model overrides
    ├── profiles.json         # mode and delegated-agent model routing
    ├── harness-mode.json     # active low/medium/high/ultra mode
    ├── extensions/           # TypeScript extensions and tests
    ├── skills/               # skill corpus loaded on demand
    ├── research/             # implementation research and evidence
    ├── themes/               # TUI themes
    ├── prompts/              # reusable prompts
    ├── scripts/              # local automation
    ├── git/                  # Git-specific ignored state
    └── npm/                  # npm-specific local state
```

## Agent extensions

`agent/extensions/harness/` is the main extension package. It resolves the active mode, validates profiles, registers tools, manages background processes, and runs delegated agents in isolated sessions.

The locked main-agent tool surface is:

| Tool | Purpose |
| --- | --- |
| `shell_command` | Run bounded, non-interactive shell commands |
| `shell_command_status` | Poll background commands |
| `shell_command_cancel` | Cancel background process trees |
| `read` | Read text files and images with truncation support |
| `apply_patch` | Apply atomic, structured file patches |
| `skill` | Discover and load a skill by exact name |
| `finder` | Delegate read-only local codebase discovery |
| `oracle` | Request a senior technical second opinion |
| `librarian` | Delegate remote repository and web research |
| `task` | Delegate a bounded implementation task |
| `mcp` | Access MCP-backed integrations through `pi-mcp-adapter` |

Modes (`low`, `medium`, `high`, and `ultra`) select main-agent model and reasoning settings. `agent/profiles.json` independently routes `finder`, `oracle`, `librarian`, and `task`; `agent/harness-mode.json` stores the active mode.

## Extensions

Pi loads extension entry points from `agent/extensions/`.

| Extension | Purpose |
| --- | --- |
| `harness/` | Main tool surface, modes, profiles, skills, and delegated-agent runtime |
| `prompt-box/` | Bordered editor with model, reasoning, token, cwd, branch, and throughput metrics |
| `cc-patch.ts` | Anthropic subscription request compatibility while retaining Pi's OAuth flow |
| `context.ts` | `/context` inspector for loaded context, skills, extensions, and token usage |
| `session-breakdown.ts` | `/session-breakdown` activity, token, cost, model, and project analytics |
| `undo.ts` | `/undo` rewind to the previous user message |
| `whimsical.ts` | Rotating thinking and working status text |

## Skills

The skill corpus under `agent/skills/` contains focused workflows loaded only when needed:

```text
code-review                    improve-codebase-architecture
codebase-design                librarian
comments-review                pi-docs
deep-review                    prototype
diagnosing-bugs                research
domain-modeling                setup-matt-pocock-skills
fin-content                    sync-pocock-skills
grill-me                       tdd
grill-with-docs                to-spec
grilling                       to-tickets
handoff                        triage
implement                      wayfinder
writing-great-skills
```

Each skill owns its instructions in `agent/skills/<name>/SKILL.md`. Supporting references, templates, scripts, and patches stay beside the owning skill.

## Repository guidance

[`AGENTS.md`](AGENTS.md) defines repository-specific behavior and links to the canonical files under [`docs/agents/`](docs/agents/):

- GitHub Issues are the issue and PRD tracker.
- Triage uses the repository's canonical category and state labels.
- [`CONTEXT.md`](CONTEXT.md) and future `docs/adr/` entries define domain vocabulary and decisions.

## Local state and secrets

Runtime state is intentionally excluded by `agent/.gitignore`, including sessions, caches, dependencies, OAuth data, MCP configuration, trust state, evaluator output, and local prompt additions. In particular, files such as `agent/auth.json`, `agent/mcp.json`, and `agent/trust.json` must remain untracked.

## Development

Extension dependencies and checks are isolated under `agent/extensions/`:

```bash
cd ~/.pi/agent/extensions
pnpm install
pnpm exec vitest run
pnpm exec tsc --noEmit
```

The package uses TypeScript, Vitest, and Pi's extension APIs. No repository-root package installation is required.

## Related

- [pi coding agent](https://github.com/earendil-works/pi-mono/tree/main/packages/coding-agent)
- [grug brained developer](https://grugbrain.dev)
