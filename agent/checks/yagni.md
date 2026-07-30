---
name: yagni
description: Find new machinery that can be deleted or inlined without losing requested behavior or current callers.
severity-default: high
---

**Deletion proof.** Report new machinery only when repository evidence proves it can be deleted or inlined while preserving requested behavior and every current caller:

- a generic seam, interface, strategy, registry, or adapter role with one current implementation and no current variation;
- an option, mode, hook, fallback, or configuration surface with no current caller or requirement;
- claimed generality contradicted by hard-coded behavior that permits only one case;
- lifecycle or extension machinery supporting only hypothetical future behavior.

Delete or inline the machinery; that simpler direct flow is the complete correction.

Framework-required structure, repository conventions, explicit requirements, and modules that hide signing, sequencing, translation, policy, or other caller knowledge satisfy this Check. One implementation and line count are insufficient evidence.

Evidence must cite the generality claim or extension point, account for every current implementation and caller, and explain what remains after deletion. If preserving behavior is uncertain, submit zero issues rather than lowering severity.
