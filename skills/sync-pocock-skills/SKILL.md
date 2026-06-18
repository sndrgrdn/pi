---
name: sync-pocock-skills
description: Sync Matt Pocock's skills from upstream (github.com/mattpocock/skills), apply pi-specific patches that translate Claude Code sub-agent references to Pi's subagent tool, and flag new skills or unpatched patterns. Use when user says "sync skills", "update pocock skills", or "check for skill updates".
disable-model-invocation: true
---

# Sync Pocock Skills

Sync our copies of [mattpocock/skills](https://github.com/mattpocock/skills) against upstream, apply pi-specific patches, and flag anything new.

## Quick start

Run the sync analysis script, then follow its output. Use absolute paths from this skill directory so `$0`/current-directory confusion does not matter:

```bash
SKILL_ROOT="$HOME/.pi/agent/skills/sync-pocock-skills"
bash "$SKILL_ROOT/scripts/sync.sh" "$HOME/.pi/agent/skills" "$SKILL_ROOT/patches" --keep-upstream
```

## Workflow

### 1. Analyse

Run `scripts/sync.sh` with args `<skills_dir>` `<patches_dir>`, usually with `--keep-upstream` so the printed upstream clone remains available for inspection:

```bash
SKILL_ROOT="$HOME/.pi/agent/skills/sync-pocock-skills"
bash "$SKILL_ROOT/scripts/sync.sh" "$HOME/.pi/agent/skills" "$SKILL_ROOT/patches" --keep-upstream
```

Options:

- `--keep-upstream` — retain the temp upstream clone after the script exits.
- `--upstream-dir <dir>` — clone upstream into a specific path and retain it.

Parse the output sections:

- **NEW_SKILLS** — upstream skills not installed locally and not in `ignored.txt`. Ask the user which to add.
- **UPSTREAM_CHANGES** — files that changed upstream in installed skills. Shows whether changes conflict with our patches.
- **UNPATCHED_PATTERNS** — Claude Code-specific references in our skills that lack patches.
- **UPSTREAM_DIR** — path to the cloned upstream `skills/` root. It is retained only when you passed `--keep-upstream` or `--upstream-dir`.

Important: `UPSTREAM_DIR` is the upstream skills root, not a directly usable skill directory. Upstream skills are grouped by category (for example `engineering/diagnose`), so do **not** call `apply-upstream.sh` with `$UPSTREAM_DIR/$skill`. Resolve the exact upstream skill directory first:

```bash
upstream_root="<UPSTREAM_DIR from sync output>"
skill="diagnose"
upstream_skill_dir=$(find "$upstream_root" -mindepth 2 -maxdepth 2 -type d -name "$skill" -print -quit)
```

### 2. Handle new skills

For each `NEW:` entry, show the name, category, and description. Ask the user whether to:

- **Install** — run `scripts/install-new.sh`, then scan its output for patterns needing patches (removes from `ignored.txt` if previously ignored).
- **Ignore** — append to `patches/ignored.txt` so future syncs skip it.
- **Skip** — do nothing; it will show up again on the next sync.

Install with:

```bash
bash scripts/install-new.sh <skill_name> <upstream_skill_dir> <skills_dir> <patches_dir>
```

### 3. Apply upstream changes

For each `CHANGED:` entry:

- **"upstream changed, no patch"** — safe to overwrite with upstream. Run `scripts/apply-upstream.sh`.
- **"upstream changed, has patch"** — read the upstream diff, update our copy from upstream, re-apply the patch and configured local overrides. If the patch conflicts, read both versions, resolve manually, then regenerate the patch with `scripts/make-patch.sh`.
- **"patch conflict"** — the patch no longer applies. Read both the upstream file and our current file, resolve, regenerate patch.
- **"new file"** — copy from upstream.
- **"removed upstream"** — flag to user, suggest removing.

Apply with:

```bash
SKILL_ROOT="$HOME/.pi/agent/skills/sync-pocock-skills"
upstream_root="<UPSTREAM_DIR from sync output>"
skill="<skill_name>"
upstream_skill_dir=$(find "$upstream_root" -mindepth 2 -maxdepth 2 -type d -name "$skill" -print -quit)
[[ -n "$upstream_skill_dir" ]] || { echo "missing upstream skill dir for $skill"; exit 1; }
bash "$SKILL_ROOT/scripts/apply-upstream.sh" "$skill" "$upstream_skill_dir" "$HOME/.pi/agent/skills" "$SKILL_ROOT/patches"
```

After each apply, inspect the actual working-tree diff for that skill before summarising. Call out metadata-only changes explicitly.

### 4. Handle unpatched patterns

For each `UNPATCHED:` entry, read the flagged file and create a patch:

1. Read the file and identify the Claude Code-specific patterns.
2. Edit the file to translate them to Pi equivalents (see [Patch conventions](#patch-conventions)).
3. Regenerate the patch:

```bash
bash scripts/make-patch.sh <skill_name> <rel_path> <upstream_file> <our_file> <patches_dir>
```

4. This skill is now self-updated — the new patch is stored for future syncs.

`make-patch.sh` writes stable patch headers (`upstream/<skill>/<path>` and `ours/<skill>/<path>`) so patches do not churn when temp clone paths change.

### 5. Verify and summarise

After applying changes:

1. Rerun `sync.sh` with `--keep-upstream` and confirm there are no unexpected `UPSTREAM_CHANGES` or `UNPATCHED_PATTERNS`.
2. Run `git diff -- <changed skill paths>` and read it before reporting. Do not assume a `CHANGED:` entry means the skill body changed; the net diff may be metadata-only after patches and local overrides.
3. Include the skill diffs in the final response. For short diffs, paste the full fenced `diff`. For very long diffs, include `git diff --stat`, the important hunks, and say that the full diff is available.

Report to the user:
- Skills added
- Skills updated (with/without patch re-application)
- New patches created
- Any conflicts that need manual attention
- Net skill changes, separating frontmatter/metadata changes from instruction-body changes
- The actual diff for changed skill files

## Local overrides

`patches/sync-excludes.txt` lists per-skill file exclusions (`<skill>/<rel_path>`, one per line). Excluded files are neither copied from upstream nor deleted locally, and `sync.sh` does not flag them as "new file upstream" or "removed upstream". Use it for local-only files (e.g. `tdd/SOURCES.md`) and upstream files we deliberately decline (e.g. `tdd/tests.md`).



## Patch conventions

When replacing Claude Code-specific patterns, use these Pi equivalents:

| Claude Code pattern | Pi replacement |
|---|---|
| `Agent tool with subagent_type=Explore` | `subagent({ agent: "explore" })` |
| `Spawn N sub-agents in parallel using the Agent tool` | `subagent({ tasks: [{ agent: "general", task: "..." }, ...] })` |
| `sub-agent` / `subagent` (generic, Claude Code context) | Translate to Pi `subagent()` tool syntax |
| `CLAUDE.md` checked first | `AGENTS.md` checked first, `CLAUDE.md` as fallback |

**Note:** Pi has native subagent support. Unlike setups without subagents, we translate the syntax rather than removing the concept. Generic uses of "subagent" that aren't Claude Code-specific do not need patching.

## Tracking

Tracking is implicit: any installed skill that also exists upstream is compared and updated. No whitelist needed.

`patches/ignored.txt` lists upstream skills you've explicitly declined. They won't appear in `NEW_SKILLS` on future syncs. Installing a previously-ignored skill removes it from `ignored.txt`.

## File layout

```
sync-pocock-skills/
├── SKILL.md                                    # This file
├── scripts/
│   ├── sync.sh                                 # Analyse upstream vs ours
│   ├── apply-upstream.sh                       # Copy upstream + re-apply patches/overrides
│   ├── install-new.sh                          # Install a new upstream skill + add to tracked.txt
│   └── make-patch.sh                           # Generate a patch file with stable labels
└── patches/
    ├── ignored.txt                             # Skills explicitly declined
    ├── sync-excludes.txt                       # Per-skill file exclusions (keep local-only / omit upstream)
    ├── setup-matt-pocock-skills__SKILL.md.patch
    └── tdd__SKILL.md.patch
```
