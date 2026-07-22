---
description: "Implement a spec or set of tickets through tested, reviewable slices."
---

## Work

$@

## Process

Implement the work described by the spec or tickets.

Before changing code, resolve and record the current `HEAD` commit SHA as the review fixed point and note any pre-existing changes.

Use `/tdd` where possible, at pre-agreed seams. Run focused tests and typechecking regularly, and the full test suite once at the end.

Commit only this task's changes, then run `/deep-review` with the Design and Craft judges, explicitly passing the recorded fixed-point SHA and original work. Resolve or account for every finding and rerun affected checks.

Commit any review fixes to the current branch. Leave pre-existing changes untouched.

If the work came from a tracker ticket, close the ticket with a comment noting the branch and commit SHA once the slice is committed and all review findings are resolved. Do not close or modify any parent issue.
