---
name: boundary-parsing
description: Find unparsed boundary values flowing inward.
severity-default: high
---

**Parse, don't validate** (King) — external, serialized, persisted, or configuration values flowing inward unrefined; checking a value and continuing with the original is not parsing. → Parse at the boundary; the refined value flows inward, raw shapes stay out of the core. **Presumptive blocker.** Evidence: the boundary plus the raw value's inward path (file:line).
