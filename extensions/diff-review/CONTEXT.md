# Diff Review

Browser UI to review the git working tree and send feedback to pi.

## Language

**Diff**: Working tree vs `HEAD`, plus untracked files. _Avoid_: patch, PR diff

**Review**: Decision + optional summary + line Comments sent to pi. _Avoid_: submission

**Comment**: Per-line note on a file/side/range. Code/Pierre: `annotation`. _Avoid_: renaming Pierre types

**Session**: Local HTTP server for one pi cwd. _Avoid_: tab

**Decision**: Comment, Approve, or Request changes — steers pi tone, not merge. _Avoid_: verdict

**Binary file**: In tree + stats; no diff panel. _Avoid_: raw binary diff

**Review shell**: Browser mount/teardown for a Diff. _Avoid_: bootstrap

**Comment module**: Draft → commit lifecycle for line Comments. _Avoid_: annotation helpers

**Session module**: HTTP server + live Diff fetch + Review receive. _Avoid_: index handlers

## Relationships

- **Diff** fetched fresh on each page load; reload wipes Comments (no warning)
- **Review** = Comments + optional summary + **Decision**
- **Approve** may be empty; Comment/Request changes need ≥1 Comment or summary
- Re-run `diffs` → reuse **Session** URL, always open browser

## Constraints

- Perf: Pierre owns render; files start expanded; default unified
- Keys: ↑↓ u/s / r Esc — no j/k
- Out of scope: PR diffs, auth, threads, polling

## Example dialogue

> **Dev:** "Committed — diff empty?"
> **Expert:** "Yes. **Diff** is vs HEAD."

> **Dev:** "Code says annotation?"
> **Expert:** "Same as **Comment** — Pierre naming."
