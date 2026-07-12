---
name: librarian
description: "Cache and refresh remote git repositories under ~/.cache/checkouts/<host>/<org>/<repo>. Use when the user references a remote git repo (URL, owner/repo, or a bare repo name like 'opencode' or 'minijinja' that may already be cached locally)."
disable-model-invocation: true
---

Use this skill when the user references a remote git repository — URLs, `git@...`, `owner/repo` shorthand, or a bare repo name that may already exist in the local cache.

Goals: **stable** paths, **up-to-date** checkouts, **efficient** partial clones.

## Cache location

`~/.cache/checkouts/<host>/<org>/<repo>`

## Resolution flow

Always call the checkout command. It owns qualified-reference parsing and the
bare-name resolution matrix, so the skill and Librarian tool cannot drift.

### Checkout command

```bash
bash checkout.sh <repo>
```

The script will:
1. Parse the reference into host/org/repo.
   For a bare name, refresh the sole cached match; list multiple candidates;
   or ask for `owner/repo` when none exists.
2. Clone with `--filter=blob:none` if missing.
3. Reuse existing checkout if present.
4. Fetch from `origin` when stale (default: 300s).
5. Fast-forward merge if checkout is clean and has upstream.

## Update strategy

- **Throttled refresh** every 5 minutes by default.
- Refreshes are throttled by the shared implementation; there is no force-refresh override.

## Recommended workflow

1. Resolve path via the [resolution flow](#resolution-flow) above.
2. Use the resolved local path for searching, reading, and analysis.
3. On later references, re-run `checkout.sh` with `host/org/repo` — it refreshes the cached checkout.

## If edits are needed

Do not edit the shared cache directly. Create a worktree or copy for task-specific modifications.

## Notes

- `owner/repo` defaults to `github.com`.
- Bare names resolve from cache only; the implementation never guesses an owner.
