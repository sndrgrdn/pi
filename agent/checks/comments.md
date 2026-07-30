---
name: comments
description: Find changed comments that narrate obvious code or sprawl beyond the non-obvious fact they preserve.
severity-default: low
---

**Explain surprises.** Inspect only comments added or modified by the diff. Report a comment when it:

- restates names, syntax, transformations, or control flow that the code already makes obvious;
- adds decorative documentation to an ordinary public function, wrapper, job, or leaf helper;
- duplicates an explanation already present nearby;
- sprawls beyond the shortest statement of the non-obvious fact it preserves.

A comment earns its place by recording what code cannot say clearly: a gotcha, footgun, invariant, ownership or ordering rule, tradeoff, or why the obvious implementation is wrong.

Delete narration. When it contains a non-obvious fact, reduce it to the shortest statement of that fact. Comment absence and symbol visibility are outside this Check.

Evidence must cite the changed comment and the code that makes it redundant, or identify the single non-obvious fact to retain. Keep all findings at `low` severity.
