---
name: deletion-test
description: Find new pass-through modules whose interfaces hide no meaningful knowledge from callers.
severity-default: medium
---

**Deletion test.** Report a new module only when it forwards the same inputs and output to one target, hides no invariant, policy, sequencing, translation, lifecycle, or repeated knowledge, and leaves callers with equal or less knowledge after deletion.

Short does not mean shallow. A small function can earn its place by owning policy or giving several callers one operation whose details would otherwise be repeated. Jobs, controllers, commands, serializers, and framework hooks may be necessarily thin when their interface supplies a framework entry point, lifecycle, or protocol role.

Delete the pass-through and call the real target directly; the direct call is the complete correction.

Evidence must show the module's interface, everything its implementation does, and the resulting direct call after deletion. Use `high` only when several callers or modules duplicate the pass-through architecture.
