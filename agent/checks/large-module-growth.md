---
name: responsibility-growth
description: Find changed modules taking on a responsibility already owned elsewhere.
severity-default: medium
---

**Existing owner.** Report growth only when changed code gives a module a clearly unrelated responsibility that an existing module already owns.

Evidence must name the changed module's established responsibility, the new unrelated responsibility, and its existing owner. Size, line count, percentage growth, or function length are not evidence by themselves.

Move the decision or behavior to that existing owner. An absent owner yields zero issues from this Check.

Cohesive local growth and linear orchestration satisfy this Check regardless of length. Keep findings at `medium` severity or lower.
