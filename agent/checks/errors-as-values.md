---
name: error-contract
description: Find expected failures distinguished through unstable or erased error information.
severity-default: medium
---

**Stable failures.** Report a changed expected-failure path only when callers demonstrably depend on a distinction that the code makes unstable or erases:

- parsing exception or error-message prose to decide behavior;
- broadly rescuing failures that require different retry, authorization, billing, or persistence behavior;
- using the same `nil`, boolean, or sentinel string for expected outcomes that a caller must distinguish.

Use the smallest repository-native stable discriminant: a specific exception class, existing result type, or equivalent error contract.

A specific exception with one recovery owner, a defect exception, or one user-facing failure with no caller distinction satisfies this Check. Typed results are one representation, not the target.

Evidence must cite the unstable or erased distinction and the caller behavior that depends on it. Use `high` only when the ambiguity can cause an incorrect retry, authorization decision, charge, or durable write.
