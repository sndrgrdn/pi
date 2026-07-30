---
description: Implement a spec or set of tickets through tested, reviewable slices.
---

## Work

$@

## Process

Implement the work described by the spec or tickets.

Before changing code, resolve and record the current `HEAD` commit SHA as the review fixed point and note any pre-existing changes.

Use `/tdd` where possible, at pre-agreed seams. Run focused tests and typechecking regularly, and rerun the affected tests once at the end.

Commit only this task's changes, then call `code_review` exactly once with `git diff <fixed-point-sha>...HEAD` as the diff description, substituting the recorded SHA. Pass the original work item in `instructions` and ask the review to flag requirements that are missing or only partially implemented, behavior the work item did not request, and implementations that look wrong against the work item. Resolve or account for every Comment and rerun affected checks.

Commit any review fixes to the current branch. Leave pre-existing changes untouched.

If the work came from a tracker ticket, close the ticket with a comment noting the branch and commit SHA once the slice is committed and all review findings are resolved. Do not close or modify any parent issue.
