---
name: librarian
description: "Cache and refresh remote git repositories under ~/.cache/checkouts/<host>/<org>/<repo>. Use when the user references a remote git repo (URL, owner/repo, or a bare repo name like 'opencode' or 'minijinja' that may already be cached locally)."
disable-model-invocation: true
---

Use this skill when the user references a remote git repository — URLs, `git@...`, `owner/repo` shorthand, or a bare repo name that may already exist in the local cache.

Goals: **stable** paths, **up-to-date** checkouts, **efficient** partial clones.

## Cache location

`~/.cache/checkouts/<host>/<org>/<repo>`

## Resolution flow — always start here

Determine input type first, then follow the matching path:

| Input shape | Examples | Action |
|-------------|----------|--------|
| URL / `git@` / `owner/repo` | `https://github.com/foo/bar`, `foo/bar` | → [Checkout command](#checkout-command) |
| **Bare repo name** (no `/`) | `opencode`, `minijinja` | → [Cache lookup](#cache-lookup) **first** |

### Cache lookup

**Never call `checkout.sh` with a bare name.** The script requires `owner/repo` at minimum.

Step 1 — search:
```bash
find ~/.cache/checkouts -type d -name '<repo>' -prune
```

Step 2 — filter to actual repo roots:
```bash
# For each match, verify it is a repository root, not a nested directory:
git -C <path> rev-parse --show-toplevel 2>/dev/null
# Keep only paths where the output equals <path> itself.
```

Step 3 — decide:

| Result | Action |
|--------|--------|
| Exactly one repo root | Derive `<host>/<org>/<repo>` from the path and call `checkout.sh <host>/<org>/<repo> --path-only` to refresh |
| Multiple repo roots | Show candidate paths and ask the user which one |
| No matches | Ask for `owner/repo` or full URL — do **not** guess the org |

### Checkout command

For fully-qualified repo identities only:

```bash
bash checkout.sh <repo> --path-only
```

The script will:
1. Parse the reference into host/org/repo.
2. Clone with `--filter=blob:none` if missing.
3. Reuse existing checkout if present.
4. Fetch from `origin` when stale (default: 300s).
5. Fast-forward merge if checkout is clean and has upstream.

## Update strategy

- **Throttled refresh** every 5 minutes by default.
- Force immediate: `bash checkout.sh <repo> --force-update --path-only`

## Recommended workflow

1. Resolve path via the [resolution flow](#resolution-flow--always-start-here) above.
2. Use the resolved local path for searching, reading, and analysis.
3. On later references, re-run `checkout.sh` with `host/org/repo` — it refreshes the cached checkout.

## If edits are needed

Do not edit the shared cache directly. Create a worktree or copy for task-specific modifications.

## Notes

- `owner/repo` defaults to `github.com`.
- `checkout.sh` does not accept bare names — always resolve via cache lookup first.
