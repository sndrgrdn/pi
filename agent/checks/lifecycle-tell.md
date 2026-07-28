---
name: lifecycle-tell
description: Find divergent-lifecycle data bolted onto a host table that lives by a different clock.
severity-default: high
---

**Lifecycle tell** (Evans, aggregates) — data that owns its own lifecycle (retention, cadence, write ownership) is its own aggregate. Columns bolted onto a host table whose rows live by a different clock are the finding — the diff's own retention or cleanup machinery is the confession: a payload needing its own pruning job needed its own table. **Presumptive blocker.** Evidence: the divergent-lifecycle hunk (the retention/cleanup code) plus the host table it scans.
