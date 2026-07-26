---
description: Review an explicit diff once and return the review unchanged.
argument-hint: "[diff-description]"
---

Run one Code Review for this diff description:

<diff-description>
$ARGUMENTS
</diff-description>

If the description is empty, use `uncommitted changes` as the diff description.

Call `code_review` exactly once with that diff description. Do not call any other tool.

Uncommitted or staged work, named refs, explicit ranges, and branch work against the upstream default resolve without help. Ask which ref to diff against only when the description needs a base, none is named, and no upstream default exists. Never assume `main` or `master`.

After `code_review` completes, present its result as-is and stop. Do not summarize it or fix anything unless asked in a later message.
