---
name: errors-as-values
description: Find expected failures hidden in exceptions instead of typed results.
severity-default: medium
---

**Errors as values** (Ousterhout ch. 10) — expected failures hidden in throws or rejected promises. → Expected failures travel as typed results or error values with stable discriminants; exceptions are for defects, which fail fast.
