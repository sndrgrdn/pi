---
name: contract
description: Find scattered consumer-side guards compensating for a missing producer contract.
severity-default: high
---

**Contract** (Meyer, design by contract) — consumer-side nil/error checks compensating for an unenforced contract upstream; scattered guards across call sites signal a missing invariant at the source. → Enforce the contract at the producer, in one place; strip the consumer guards. **Presumptive blocker.** Evidence: the scattered consumer checks (file:line each) plus the producer that should enforce.
