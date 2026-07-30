---
name: contract
description: Find concrete mismatches between what a producer promises or emits and what a consumer accepts.
severity-default: medium
---

**Match both sides.** Report only a directly observable mismatch between an established producer contract and a consumer:

- the producer promises or emits an identifier, variant, or state the consumer rejects or cannot interpret;
- changed callers add repeated guards for an output the producer promises cannot occur;
- a consumer assumes a narrower result than the producer's established interface provides.

Repeated guards support a finding only when they compensate for the same broken promise. Expected optional results, intentional subsets, and boundary validation satisfy their contracts.

Fix the incorrect side with the smallest change: narrow the producer, broaden the consumer, or correct the caller assumption. Use the existing interface; a wrapper, result hierarchy, shared schema, or new module needs independent current justification.

Evidence must cite both sides, identify the established promise, and show the incompatible value or state. If the promise or mismatch cannot be established from the repository, submit zero issues. Use `high` only when the mismatch is demonstrably reachable and causes incorrect behavior, security exposure, or rejection of valid work.
