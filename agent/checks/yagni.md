---
name: yagni
description: Find speculative abstractions, patterns, or seams introduced without a current need.
severity-default: high
---

**YAGNI** (Beck, *XP Explained*; absorbs Fowler's Speculative Generality) — a new abstraction, pattern, library, or seam serving no current need; machinery introduced without inspecting existing contracts, modules, and tests. → Inline until a real need arrives; make the smallest coherent change that serves what exists now.

**Single-implementer generality** is the high-severity subtype: machinery advertised as generic with one adapter is a hypothetical seam — a stronger finding when the mechanism cannot support a second implementer as built (a clobbering write, a hardcoded key). **Presumptive blocker.** Evidence: the generality claim (quoted), the single implementer, and where applicable the mechanism that blocks a second.
