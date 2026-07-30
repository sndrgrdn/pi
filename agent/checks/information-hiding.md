---
name: type-escape-hatches
description: Find `any` and `unknown` introduced where the value's real type is already known or should be parsed once.
severity-default: medium
---

**Precise inward.** Report every changed use of `any` in authored code. An immutable external or framework declaration is the sole exception.

Report `unknown` when it:

- appears in an internal interface whose callers already supply one established type;
- propagates beyond the genuine untyped seam that received it instead of being parsed or narrowed once;
- becomes internal state and forces downstream guards, casts, or repeated interpretation.

`unknown` is valid momentarily at a runtime seam when immediate refinement gives inward code a precise type. It is also valid for data opaque to the entire module: the module neither reads, serializes, persists, nor branches on it. Preserve caller type information with an existing generic; use an existing serializable type for stored or serialized values.

Fix the earliest interface that knows the shape, using an existing type, inference, parser, or local narrowing. A local inferable shape stays local. Optionality and unnamed objects are outside this Check.

Evidence must cite the broad type, the source that establishes the real shape, and any downstream checks or casts it causes. Use `high` only when one broad source type weakens interfaces across modules or causes repeated defensive handling.
