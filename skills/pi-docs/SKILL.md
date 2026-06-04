---
name: pi-docs
description: Pi coding agent documentation and source lookup. Use when asked about pi itself, creating extensions, understanding pi internals, its SDK, themes, skills, prompt templates, TUI, keybindings, custom providers, models, packages, system prompt, or how pi works under the hood.
disable-model-invocation: true
---

# Pi Documentation & Source Navigation

Reference pi's official docs and source when working on pi-related topics.

## Step 1: Resolve PI_ROOT

```bash
PI_ROOT=$(dirname "$(dirname "$(readlink -f "$(which pi)")")")
```

All paths below are relative to `PI_ROOT`.

## Step 2: Load by Topic

### Documentation

| Topic | Path |
|-------|------|
| Overview | `README.md` |
| Usage & system prompt files | `docs/usage.md` |
| Extensions | `docs/extensions.md` |
| Themes | `docs/themes.md` |
| Skills | `docs/skills.md` |
| Prompt templates | `docs/prompt-templates.md` |
| TUI / components | `docs/tui.md` |
| Keybindings | `docs/keybindings.md` |
| SDK / embedding | `docs/sdk.md` |
| Custom providers | `docs/custom-provider.md` |
| Adding models | `docs/models.md` |
| Pi packages | `docs/packages.md` |
| Sessions | `docs/sessions.md`, `docs/session-format.md` |
| Settings | `docs/settings.md` |
| Compaction | `docs/compaction.md` |
| Containerization | `docs/containerization.md` |
| JSON / print mode | `docs/json.md` |
| RPC | `docs/rpc.md` |
| Providers | `docs/providers.md` |
| Development | `docs/development.md` |
| Shell aliases | `docs/shell-aliases.md` |
| Terminal setup | `docs/terminal-setup.md` |
| Tmux | `docs/tmux.md` |
| Termux | `docs/termux.md` |
| Windows | `docs/windows.md` |
| Quickstart | `docs/quickstart.md` |

### Source Code (internals & implementation)

| Area | Path | Key exports |
|------|------|-------------|
| System prompt construction | `dist/core/system-prompt.js` | `buildSystemPrompt` |
| Config & path resolution | `dist/config.js` | `getPackageDir`, `getDocsPath`, `getAgentDir`, `CONFIG_DIR_NAME` |
| Resource loader | `dist/core/resource-loader.js` | `DefaultResourceLoader`, `loadProjectContextFiles` |
| SDK entry point | `dist/core/sdk.js` | `createAgentSession`, `createCodingTools`, `createReadOnlyTools` |
| Agent session | `dist/core/agent-session.js` | Session lifecycle, tool registration |
| Bash executor | `dist/core/bash-executor.js` | Command execution internals |
| Skills loader | `dist/core/skills.js` | Skill discovery, `formatSkillsForPrompt` |
| Prompt templates | `dist/core/prompt-templates.js` | Template loading & expansion |
| Model registry | `dist/core/model-registry.js` | Model resolution & provider mapping |
| Settings manager | `dist/core/settings-manager.js` | Settings file handling |
| Extension runner | `dist/core/extensions/runner.js` | Extension lifecycle & hooks |
| Extension types | `dist/core/extensions/types.js` | Extension API surface |
| Compaction | `dist/core/compaction/compaction.js` | Context window management |
| Keybindings | `dist/core/keybindings.js` | Key mapping internals |
| Messages | `dist/core/messages.js` | Message formatting |

### Extension Examples

| Example | Path | Shows |
|---------|------|-------|
| Custom Anthropic provider | `examples/extensions/custom-provider-anthropic/` | Provider integration |
| Custom GitLab Duo provider | `examples/extensions/custom-provider-gitlab-duo/` | Provider integration |
| Dynamic resources | `examples/extensions/dynamic-resources/` | Runtime resource injection |
| Plan mode | `examples/extensions/plan-mode/` | Custom mode extension |
| Subagent | `examples/extensions/subagent/` | Subagent delegation |
| Sandbox | `examples/extensions/sandbox/` | Sandboxed execution |
| With dependencies | `examples/extensions/with-deps/` | Extension with npm deps |
| Doom overlay | `examples/extensions/doom-overlay/` | TUI overlay |
| Gondolin | `examples/extensions/gondolin/` | Full-featured extension |

## Step 3: Follow Cross-References

Pi docs reference each other. When a doc mentions another topic, read that file too.
When reading source, check imports at the top of each file for related modules.

## System Prompt Construction

Read `dist/core/system-prompt.js` → `buildSystemPrompt(options)` for the full implementation.

Assembly order:
1. Custom prompt (`SYSTEM.md`) or default built-in prompt
2. `APPEND_SYSTEM.md` content appended
3. `<project_context>` block with `AGENTS.md` / context files
4. Skills section (when read tool available)
5. `Current date` and `Current working directory`

The default prompt (no `SYSTEM.md`) includes:
- Tool list from `selectedTools` + `toolSnippets`
- Guidelines (dynamic based on available tools)
- Pi docs section pointing to `README.md`, `docs/`, `examples/` via absolute paths from `config.js`

Prompt file discovery (`dist/core/resource-loader.js` → `discoverSystemPromptFile()`):
- `SYSTEM.md`: `.pi/SYSTEM.md` (project) → `~/.pi/agent/SYSTEM.md` (global) — replaces default
- `APPEND_SYSTEM.md`: same lookup order — appends without replacing
