---
name: deletion-test
description: Find pass-through modules that hide no meaningful complexity from their callers.
severity-default: high
---

**Deletion test** (Ousterhout ch. 4) — imagine the module gone: if complexity vanishes, it was a pass-through; if complexity reappears across N callers, it earns its keep. Every interface must hide meaningful invariants, policy, sequencing, or translation; a module that fails the test is plumbing to delete, keeping the direct flow. **Presumptive blocker.** Evidence: the module's table row (interface vs. what it hides) plus what happens on deletion.
