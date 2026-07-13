---
description: "Implement a spec or set of tickets through tested, reviewable slices."
---

## Work

$@

## Process

1. Read the work, its source spec or tickets, and the repository guidance. Record the acceptance criteria, the current `HEAD` as the review fixed point, and any pre-existing working-tree changes. Ask only about ambiguity that would materially change the implementation.
2. Identify the public seams that need tests and agree them with the user. Use `/tdd` to implement one vertical slice at a time. When TDD does not fit the work, state why and choose the closest behavior-level verification.
3. For every slice, make its focused test pass and run the relevant typecheck before starting the next slice. Keep the implementation within the acceptance criteria.
4. Once every slice passes its focused checks, commit only the work from this task to the current branch.
5. Run `/code-review` against the recorded fixed point and the original spec or tickets. Resolve every valid finding, then rerun the affected focused checks.
6. Run `~/.pi/agent/skills/deep-review/references/design.md` against the recorded fixed point and the original spec or tickets. Resolve every valid finding.
7. Run `~/.pi/agent/skills/deep-review/references/craft.md` against the recorded fixed point and the original spec or tickets. Resolve every valid finding.
8. Run the full test suite once, after review fixes. Commit any remaining task changes.

The work is complete when every acceptance criterion is implemented, review findings are resolved or explicitly accounted for, focused checks and the final suite pass, all task changes are committed, and pre-existing changes remain untouched.
