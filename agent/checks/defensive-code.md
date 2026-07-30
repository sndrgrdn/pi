---
name: defensive-code
description: Find redundant or speculative guards and fallbacks.
severity-default: medium
---

**Reality, not hypotheticals.** Report a changed guard or fallback only when direct evidence establishes one case:

- an existing type, constructor, constraint, framework contract, or immediately preceding operation already excludes the guarded state;
- repository search finds no current producer or caller that can supply the guarded state, and the value does not come from an external boundary;
- an invariant violation is converted into false success, empty data, or continued execution.

Fix in order: delete the guard; rely on the enforced invariant; tighten an existing local type or constructor when that is smaller. New state machinery needs independent current justification.

Guards for boundary input and expected failures are valid. A reachable state or an unproven "unlikely" state yields zero issues from this Check.

Evidence must cite the guard and the existing invariant or current producer/caller search that proves it unnecessary. Use `high` only when the fallback can silently corrupt data or report success for failed work.
