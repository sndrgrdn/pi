---
name: defensive-code
description: Find special cases and guards that should be designed out of the state model.
severity-default: high
---

Scan only changed lines. A documented repo standard overrides either rule below; skip anything tooling already enforces. Ignore pre-existing code.

Generated code drifts defensive: fallbacks where invariants belong, guards for states the design forbids, machinery papering over unclear contracts. **The guard is the finding** — the strong invariant is the fix; a handler for an impossible case is misinformation about the contract.

- **Special cases** (Ousterhout ch. 2: complexity is incremental) — new ad-hoc conditionals, one-off booleans/modes/flags, special cases inserted into flows that had no reason to know about them; a design problem, never a stylistic nit. → Move the logic behind a dedicated abstraction, or reframe the state model so the branches disappear. Evidence: the flag or branch (file:line) plus the flow it was inserted into.
- **Illegal states** (Minsky; Ousterhout ch. 10: define errors out of existence) — design types, models, schemas, and constructors so invalid combinations cannot be expressed in the first place; a runtime guard for a state the design already prevents is misinformation about the contract.
  - A domain concept owns its invariants in one home: supporting types, **smart constructors**, legal transitions, predicates co-located — callers use its operations rather than reimplementing checks or casting past them.
  - Persistence mirrors the invariants with constraints — a model invariant the schema doesn't enforce is one process restart away from false.
  - Precise operation inputs, required values; push optionality outward. When a guard looks justified by a schema's optionality, audit the schema: optionality encoding a **prose-only invariant** ("only when X") is the finding — a discriminated union or per-variant type deletes the illegal state and every guard it spawned.
  - **State machines over contradictory flags**; **exhaustive case analysis** for closed variants — a default branch that masks newly added cases is a hole in the contract.
  - Strictest for persisted data and core infrastructure: fail loudly on invariant violations — a fallback masks corruption rather than preventing it. If the design allows the bad state, fix the design; a guard papering over the gap is the finding, never the fix.
  → Tighten the type, delete the guard. Evidence: the representable illegal combination plus a guard it spawned (file:line).
