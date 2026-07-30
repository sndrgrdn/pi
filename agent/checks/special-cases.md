---
name: special-cases
description: Find feature-specific decisions duplicated or threaded through unrelated code.
severity-default: medium
---

**Localize variation.** Report feature-specific knowledge leaking through unrelated code only when changed lines prove one case:

- the same feature condition is added in multiple unrelated modules;
- a boolean or mode is threaded through multiple layers only to alter behavior at one leaf;
- a branch duplicates a decision already owned by an existing domain module.

Move the decision to the nearest existing owner and delete the duplicated or threaded knowledge. When that costs a new abstraction or more code than the branches, submit zero issues.

One local conditional, required product variation, authorization, boundary handling, and exhaustive closed-variant branching satisfy this Check.

Evidence must cite every duplicated site or trace the flag through the unrelated layers to its only consumer. Use `high` only when the duplicated decisions already produce contradictory behavior.
