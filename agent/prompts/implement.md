---
description: "Implement a spec or set of tickets through tested, reviewable slices."
---

## Work

$@

## Process

Implement the work described by the spec or tickets.

Before changing code, record the current `HEAD` as the review fixed point and note any pre-existing changes.

Use `/tdd` where possible, at pre-agreed seams. Run focused tests and typechecking regularly, and the full test suite once at the end.

Commit only this task's changes, then run `/deep-review` with the Design and Craft judges against the fixed point and original work. Resolve or account for every finding and rerun affected checks.

Commit any review fixes to the current branch. Leave pre-existing changes untouched.
