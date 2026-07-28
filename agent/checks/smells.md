---
name: smells
description: Report the diff-visible Fowler smell baseline as possible, non-blocking judgment calls.
severity-default: low
---

This baseline is deliberately small and high-precision. Smells are judgment calls, never blockers — label each "possible <smell>" and name the concrete symbols involved.

- **Mysterious Name** — a name that hides what it does or holds. → Rename; if no honest name comes, the design's murky.
- **Duplicated Code** — the same logic shape in more than one hunk or file. → Extract the shared shape, call it from both.
- **Feature Envy** — a method reaching into another object's data more than its own. → Move the method onto the data it envies.
- **Data Clumps** — the same few fields or params travelling together. → Bundle them into one type, pass that.
- **Primitive Obsession** — a primitive standing in for a domain concept. → Give the concept its own small type.
- **Repeated Switches** — the same `switch`/`if`-cascade on the same type recurring. → Polymorphism, or one map both sites share.
- **Shotgun Surgery** — one logical change forcing scattered edits across many files. → Gather what changes together into one module.
- **Divergent Change** — one module edited for several unrelated reasons. → Split so each module changes for one reason.
- **Message Chains** — long `a.b().c().d()` navigation the caller shouldn't depend on. → Hide the walk behind one method on the first object.
- **Middle Man** — a class or function that mostly delegates onward. → Cut it, call the real target direct.
- **Refused Bequest** — an implementer ignoring most of what it inherits. → Drop the inheritance, use composition.
