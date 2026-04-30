---
name: pi-docs
description: Pi coding agent documentation lookup. Use when asked about pi itself, its SDK, extensions, themes, skills, prompt templates, TUI, keybindings, custom providers, models, packages, or how to customize pi.
disable-model-invocation: true
---

# Pi Documentation

Reference pi's official docs when working on pi-related topics.

## Step 1: Resolve Pi Installation Path

Run to get the pi package root:

```bash
pnpm root -g | xargs -I{} echo "{}/@mariozechner/pi-coding-agent"
```

This returns `PI_ROOT`. All doc paths below are relative to this.

## Step 2: Load Documentation by Topic

| Topic | Read |
|-------|------|
| General / overview | `README.md` |
| Extensions | `docs/extensions.md`, then `examples/extensions/` |
| Themes | `docs/themes.md` |
| Skills | `docs/skills.md` |
| Prompt templates | `docs/prompt-templates.md` |
| TUI / components | `docs/tui.md` |
| Keybindings | `docs/keybindings.md` |
| SDK / embedding | `docs/sdk.md`, then `examples/sdk/` |
| Custom providers | `docs/custom-provider.md` |
| Adding models | `docs/models.md` |
| Pi packages | `docs/packages.md` |
| Sessions | `docs/session.md` |
| Settings | `docs/settings.md` |
| Compaction | `docs/compaction.md` |
| JSON / print mode | `docs/json.md` |
| RPC | `docs/rpc.md` |
| Providers | `docs/providers.md` |
| Tree view | `docs/tree.md` |

## Step 3: Follow Cross-References

Pi docs reference each other. When a doc mentions another topic (e.g., "see tui.md for TUI API details"), read that file too.

## Step 4: Check Examples

For implementation questions, check `examples/` after reading docs:

| Area | Examples Path |
|------|---------------|
| Extensions | `examples/extensions/` (40+ examples) |
| SDK usage | `examples/sdk/` (13 numbered examples) |
| Custom providers | `examples/extensions/custom-provider-*/` |
