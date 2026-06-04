# TDD Skill — Sources

## Source Inventory

| Source | URL | Trust | Contribution | Date |
|--------|-----|-------|-------------|------|
| Swett TDD skill | https://github.com/jasonswett/llm-skills/blob/main/tdd/SKILL.md | Med-High | Spec clarification loop, "clean the kitchen", pre-existing failure hygiene | 2026-06-03 |
| Swett Test Design Review | https://github.com/jasonswett/llm-skills/blob/main/test-design-review/SKILL.md | Med-High | Spec format, scenario naming, assertion discipline, AAA, abstraction levels, observable outcomes | 2026-06-03 |
| Saturn CI article | https://www.saturnci.com/my-agent-skill-for-test-driven-development.html | Medium | Philosophy context, Canon TDD reference | 2026-06-03 |
| Kent Beck Canon TDD | https://tidyfirst.substack.com/p/canon-tdd | High | Referenced as upstream authority for TDD loop | — |

## Adaptation Notes

### Adopted in `skills/tdd/` (process)

- **Specification-first framing**: Tests as executable specifications. "When X, Y happens" format.
- **Spec clarification loop**: Confirm understanding in scenario form before coding.
- **"Clean the kitchen"**: Assess existing code before adding new behavior. Refactor first when needed.
- **Pre-existing failure hygiene**: Fix failures immediately, don't continue on a dirty baseline.

### Adopted in `skills/tdd-review/` (enforcement)

- **Scenario description quality**: Name by behavior, not implementation detail.
- **Assert essential, not incidental**: No redundant assertions.
- **AAA format**: Clear Arrange-Act-Assert structure.
- **Observable outcomes**: Assert on results, not method calls.
- **Appropriate abstraction level**: Extract helpers for noisy setup.
- **No speculative test code**: Scrutinize timeouts, retries, workarounds.

### Omitted

- RSpec-specific patterns (`.first`/`.last`, `described_class`, `have_current_path`, `instance_variable_set`, forward `let!` references) — too language-specific
- `disable-model-invocation` frontmatter — Claude Code-specific
- Subagent invocation for `/test-design-review` and `/software-design-review` — separate skill concern
- SEF terminology — kept red-green-refactor as the standard term; SEF is Swett's personal framing

### Fidelity boundary

Preserved Swett's core test design principles. Rewrote all examples from RSpec/Ruby to TypeScript/generic equivalents to match existing skill conventions.

### Split rationale

Swett uses separate skills: `tdd` (process) and `test-design-review` (enforcement via separate agent). We adopted this split: `tdd` owns the creative loop, `tdd-review` owns the quality rubric. Skills are independent — no cross-references.
