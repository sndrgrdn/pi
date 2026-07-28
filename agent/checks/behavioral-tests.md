---
name: behavioral-tests
description: Find tests coupled to implementation instead of specifying observable behavior.
severity-default: medium
---

Apply to tests, including inline test modules.

**Tests are executable specifications** — each test should state a concrete scenario and assert an observable outcome. Report these diff-visible violations:

- asserting that an internal method was called rather than checking the resulting state, output, side effect, or externally visible interaction;
- reaching through private state or private methods to arrange or assert behavior;
- asserting an internal cache representation, incidental ordering, or redundant success signal instead of the resulting behavior;
- reproducing the production branch or calculation in the test and comparing the implementation with itself.

→ Exercise the public seam and assert the end result that would remain valid after an implementation-preserving refactor. Stub only boundaries that cannot reasonably run in the test.

Evidence: cite the coupled assertion or setup and name the observable outcome the test should specify. An interaction assertion is valid when that interaction is the public contract or an external boundary.
