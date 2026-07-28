---
name: special-cases
description: Special cases — new ad-hoc conditionals, one-off booleans/modes/flags, special cases inserted into flows that had no reason to know about them.
severity-default: high
---

**Special cases** (Ousterhout ch. 2: complexity is incremental) — new ad-hoc conditionals, one-off booleans/modes/flags, or feature-specific cases inserted into a flow that otherwise has no reason to know about them. → Reframe the state model so the branch disappears. When multiple present variations already exist, put them behind the concept that varies. **Presumptive blocker.** Evidence: the flag or branch (file:line) plus the unrelated flow it was inserted into.
