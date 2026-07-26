---
name: structured-concurrency
description: Structured concurrency — resources acquired outside the scope that owns their lifetime, detached work with no owner for cancellation and rejection, related updates that can leave state half-applied, independent work serialized for no reason.
severity-default: medium
---

**Structured concurrency** (Elizarov) — resources acquired outside the scope that owns their lifetime, detached work with no owner for cancellation and rejection, related updates that can leave state half-applied, independent work serialized for no reason. → Acquire in the owning scope and release on every exit; give detached work an explicit owner; make related updates atomic; parallelize when it also simplifies.
