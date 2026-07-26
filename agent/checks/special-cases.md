---
name: special-cases
description: Special cases — new ad-hoc conditionals, one-off booleans/modes/flags, special cases inserted into flows that had no reason to know about them.
severity-default: high
---

**Special cases** (Ousterhout ch. 2: complexity is incremental) — new ad-hoc conditionals, one-off booleans/modes/flags, special cases inserted into flows that had no reason to know about them; a design problem, never a stylistic nit. → Move the logic behind a dedicated abstraction, or reframe the state model so the branches disappear. **Presumptive blocker.** Evidence bar: the flag or branch (file:line) plus the flow it was inserted into.
