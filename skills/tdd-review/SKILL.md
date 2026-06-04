---
name: tdd-review
description: Review test code for design quality. Use when reviewing tests, after writing tests with TDD, when test quality is poor, tests are brittle, or tests break on refactors without behavior changes.
---

# Test Design Review

Review specified tests (or the current diff if none specified) against the guidelines below. For each violation, show the offending code and suggest a fix. Group findings by guideline.

## Core Principle

Tests are executable specifications. A specification answers: "In scenario X, what should happen?"

## Guidelines

| Guideline | Open when... |
|-----------|-------------|
| [test-design.md](test-design.md) | checking specification quality, naming, assertions, structure, abstraction |
| [mocking.md](mocking.md) | checking mock usage and boundary discipline |

## Review Process

1. Identify the test files in scope (specified files, diff, or all tests in a directory)
2. For each test file, check against every guideline in [test-design.md](test-design.md) and [mocking.md](mocking.md)
3. Report violations grouped by guideline, with:
   - The offending code snippet
   - Which guideline it violates
   - A concrete fix

## Violation Priority

| Priority | Description |
|----------|-------------|
| **High** | Tests means not ends, implementation coupling, tautological assertions |
| **Medium** | Vague specification names, mixed abstraction levels, redundant assertions |
| **Low** | Missing AAA structure, speculative test code, incidental detail not extracted |

## Output Format

For each violation:

```
### [Guideline Name] — [priority]

**File**: `path/to/test.ts`

**Problem**: [one sentence]

**Before**:
```code
...
```

**After**:
```code
...
```
```

End with a summary count: `X violations (Y high, Z medium, W low)`.
