---
name: comments-review
description: Comment policy — when a comment earns its place and when it must go. Use when writing, reviewing, or pruning code comments, or when another skill's review needs the comment policy.
---

A comment earns its place by recording what the code cannot say — intent, ownership, invariants, tradeoffs. Everything else **narrates**.

Two rules bind the policy:

- **The diff scopes it.** Judge only comments the diff added, changed, or made stale; pre-existing comment debt is out of scope.
- **Absence is a judgement call, narration is not.** A missing comment is a labelled heuristic ("possible Undocumented Internal Interface"); a narrating comment is a hard violation.

Each rule reads *what it is* → *how to fix*; match it against the diff:

- **Undocumented Entry Point** — a major entry-point module with no design comment. → add a short one: ownership, boundary, key invariants.
- **Undocumented Public Function** — an exported/public function with no doc comment (JSDoc, YARD, whatever the repo uses). → add one line stating intent.
- **Undocumented Internal Interface** — a private function defining a boundary others depend on (handler/factory, wire or storage format, signing, durable state change, retry/resume policy) with no doc comment. → add one; plain leaf helpers need none.
- **Unexplained Behavior** — a non-obvious invariant, tradeoff, or policy-driven decision left uncommented. → comment the why, not the what.
- **Narration** — a comment restating the code: obvious transformations, control flow, leaf helpers. → delete it, never improve it.
- **Stale Comment** — a comment the diff invalidated, or one too vague to check. → rewrite it short, concrete, current.

Done when every hunk in scope has been matched against every rule.
