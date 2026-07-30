---
name: behavioral-tests
description: Find changed tests that are fragile, obscure, or specify implementation instead of behavior.
severity-default: medium
---

Scope: changed test code, including inline test modules. Use production code only as context. A diff without changed tests yields zero issues.

Tests are executable specifications: given a concrete scenario, when behavior occurs, an observable outcome follows. Report a changed test when direct evidence shows that it:

- lacks a concrete scenario or leaves its claimed outcome unobserved;
- asserts private state, private methods, or internal collaborator sequencing;
- stubs internal code that can reasonably run in the test;
- reproduces a production branch or calculation and compares the implementation with itself;
- asserts incidental representation, redundant success signals, or arbitrary ordering rather than essential behavior;
- passes through a different condition than the behavior it claims to exercise;
- uses loops, branching, mutable counters, or setup machinery substantial enough to obscure the specification;
- buries the scenario beneath arbitrary data or incidental setup instead of a concrete example.

Exercise the module's deliberate interface and assert an outcome that survives implementation-preserving changes behind it. Interaction assertions are valid when the interaction crosses that interface and is itself the observable effect, such as a request to an external adapter. Assert only the essential interaction, not incidental formatting or internal orchestration. Stub external adapters and genuinely impractical boundaries; let internal collaborators run where practical.

Framework conventions remain valid unless they make the specific test fragile. Choose the smallest test-only correction at the module's existing interface.

Evidence must cite the fragile setup or assertion and name the concrete scenario and outcome it should specify. Use `low` for readability alone and `high` only when the test can pass without exercising critical behavior it claims to cover.
