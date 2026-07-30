---
name: structured-concurrency
description: Find changed concurrent work with an unowned failure, lifetime, or durable ordering gap.
severity-default: medium
---

**Owned lifetime.** Report changed concurrent or asynchronous work only when a concrete failure path or interleaving shows one defect:

- started work has no owner to observe a behaviorally relevant rejection or cancellation;
- a flag, lock, current-context value, resource, or subscription is not restored or released on every exit;
- concurrent operations can apply stale state, duplicate a durable effect, or leave related state half-applied;
- work is enqueued or acknowledged before the durable state it requires is committed.

Trace the rejection, cancellation, race, or crash point to its observable consequence. Job-system ownership and explicit best-effort failure handling satisfy the ownership requirement.

Use the smallest correction supported by current infrastructure. Serialization matters only when it demonstrably violates a requirement; performance speculation yields zero issues.

Evidence must cite where work or ownership starts, the missing owner, cleanup, or ordering, the concrete failure/interleaving, and the resulting bad state. Use `high` only for reachable data corruption, permanently stuck behavior, duplicate durable effects, or acknowledged work that can be lost.
