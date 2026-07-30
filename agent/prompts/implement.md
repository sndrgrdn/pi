---
description: Implement a spec or set of tickets through tested, reviewable slices.
---

<work>
$@
</work>

<process>
1. Before editing, record the current `HEAD` SHA as the review fixed point and note every pre-existing change.

2. Implement the work through tested slices. Use `/tdd` where possible at pre-agreed seams; run focused tests and typechecking regularly.

3. Rerun every affected test, then commit only this task's changes.

4. Call `code_review` exactly once with `git diff <fixed-point-sha>...HEAD`, substituting the recorded SHA. Pass the original work item in `instructions`; ask for missing or partial requirements, unrequested behavior, and implementations that contradict the work item.

5. Disposition every Comment before editing as `fix`, `reject`, or `already covered`. Validate it against the work item, a reachable code path, repository contracts and conventions, and existing tests. Use severity to order validation; the evidence decides. Record a concise reason for each rejection.

6. Fix concrete behavior failures and proven simplifications with the smallest correction, in this order: delete code, reuse an existing primitive, make a local edit. Add a guard, abstraction, schema, result type, configuration option, lifecycle state, or module only when the work item or current system requires it. `low` and `possible <smell>` Comments warrant changes only when the change directly removes code or concepts. When Comments conflict, the work item and existing repository contract decide.

7. Rerun affected tests and repository-native verification. Review disposition is complete when every Comment has one disposition and verification passes. Commit any review fixes; leave pre-existing changes untouched.

8. For tracker work, close the ticket with a comment naming the branch and commit SHA after review disposition is complete. Do not close or modify a parent issue.
</process>
