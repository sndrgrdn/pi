---
name: vague-concept-name
description: Find durable or widely visible concepts given placeholder names despite established vocabulary.
severity-default: medium
---

**Name the thing.** Report a changed persisted structure, public interface, or module only when it uses a placeholder such as `data`, `info`, `metadata`, `stuff`, `manager`, or `helper`, its contents have one coherent meaning, and established repository or industry vocabulary names that meaning.

Two plausible names yield zero issues. Product-facing names, accurate use-based names, and short-lived locals with clear surrounding meaning satisfy this Check.

Rename the symbol in place. Use `high` only for a newly persisted or externally exposed placeholder whose correction will become expensive.
