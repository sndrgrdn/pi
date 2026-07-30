---
name: duplicated-knowledge
description: Find one policy, invariant, classification, or transition rule copied across multiple owners.
severity-default: medium
---

**One rule, one source.** Report changed code only when it duplicates the same policy, invariant, classification, or transition rule across sites that must change together for one reason, and repository evidence identifies an existing owner or smaller source of truth.

Text similarity and shared domain vocabulary are insufficient. Persistence, UI state, adapters, and separate trust boundaries may intentionally use different representations or repeat wire-format checks.

Use the nearest existing owner or smallest existing source. An absent smaller owner yields zero issues from this Check.

Evidence must cite every duplicated rule, explain the one reason they change, and identify the existing owner. Use `high` only when copies already disagree or can drift in authorization, billing, persistence, or legal state transitions.
