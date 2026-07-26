---
name: boundary-parsing
description: Find unparsed boundary values and obscured contracts flowing inward.
severity-default: high
---

Scan only changed lines. A documented repo standard overrides either rule below; skip anything tooling already enforces. Ignore pre-existing code.

- **Parse, don't validate** (King) — external, serialized, persisted, or configuration values flowing inward unrefined; checking a value and continuing with the original is not parsing. → Parse at the boundary; the refined value flows inward, raw shapes stay out of the core. Evidence: the boundary plus the raw value's inward path (file:line).
- **Information hiding** (Parnas) — casts, `any`/`unknown`, unnecessary optionality, ad-hoc object shapes obscuring the real contract. → Explicit typed models and shared contracts; push optionality outward.
