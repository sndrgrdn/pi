# ADR 0001: Live diff fetch with session reuse

## Status

Accepted

## Context

Diff review survives Session reuse across page loads. Re-running `diffs` should reuse the same browser URL. An earlier bug showed stale diffs when the server cached the patch at startup.

## Decision

- `/api/diff` runs `git diff HEAD` + untracked on **every** GET — never cache the patch
- Re-running `diffs` **reuses** the Session when cwd matches and server is listening
- Each page load fetches fresh Diff and calls `resetState()` — no Comments retained

## Consequences

- Stale diff bugs mean the handler isn't live-fetching — fix the server, don't add client workarounds
- Pi must load current extension code once; orphaned pre-fix servers die on extension reload via `globalThis` cleanup
- Session reuse is safe only with live fetch per request
