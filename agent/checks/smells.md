---
name: smells
description: Report the diff-visible Fowler smell baseline as possible, non-blocking judgment calls.
severity-default: low
---

Smells are supporting craftsmanship signals, not defects or blockers. Submit at most the three highest-confidence findings, label each `possible <smell>`, and keep every finding at `low` severity.

Require concrete repetition, coupling, or interface burden in changed lines:

- **Mysterious Name** — a name prevents understanding and an established, more precise term exists.
- **Duplicated Code** — the same non-trivial logic appears in multiple sites that must change together.
- **Feature Envy** — behavior reconstructs another module's policy from its internals; serializers, presenters, and adapters may legitimately read another representation.
- **Data Clumps** — the same values repeatedly travel and change together across several interfaces as one established concept.
- **Primitive Obsession** — repeated validation or behavior around primitives demonstrates an existing domain concept; a primitive alone is not evidence.
- **Repeated Switches** — the same branching decision is reimplemented across multiple sites and can already be owned in one existing place.
- **Shotgun Surgery** — one logical change demonstrably requires scattered edits for the same reason.
- **Divergent Change** — changed code gives one module multiple unrelated reasons to change.
- **Message Chains** — multiple callers repeatedly navigate the same internal structure and become coupled to it; representation adapters are excluded.
- **Middle Man** — an interface primarily delegates and leaves callers with equal or less knowledge after deletion.
- **Refused Bequest** — an implementer cannot honor substantial parts of its inherited interface, shown by ignored methods, dummy values, or unsupported-operation failures.

Recommend an existing correction only when it removes more concepts or code than it adds; otherwise submit zero issues.
