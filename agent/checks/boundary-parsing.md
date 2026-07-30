---
name: boundary-parsing
description: Find untrusted boundary values whose required refinement is discarded or deferred to multiple consumers.
severity-default: medium
---

**Parse once.** Report an external, serialized, persisted, configuration, or user-provided value only when changed lines show one concrete failure:

- a parser or refinement result is discarded while the raw input flows inward;
- an ambiguous raw shape crosses modules and makes multiple consumers reinterpret which states are valid;
- untrusted input reaches authorization, billing, persistence, query construction, or control flow without a constraint that operation requires.

Fix the first owner with the smallest repository-native parser or gate. A local allowlist or conditional is sufficient when its control flow establishes safety. Framework, library, ORM, and existing domain parsing count.

Opaque configuration and provider data stay opaque until code interprets their contents. The concrete downstream decision determines the required refinement; it does not justify extra normalization or a new model by itself.

Evidence must cite the boundary, trace the raw value inward, and identify the concrete downstream interpretation that is unsafe or duplicated. Use `high` only when the value can alter authorization, billing, durable data, query structure, or executable behavior.
