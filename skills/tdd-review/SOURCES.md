# TDD Review — Sources

## Source Inventory

| Source | URL | Trust | Contribution |
|--------|-----|-------|-------------|
| Swett Test Design Review | https://github.com/jasonswett/llm-skills/blob/main/test-design-review/SKILL.md | Med-High | Spec format, scenario naming, assertion discipline, AAA, abstraction levels, observable outcomes |
| Swett TDD skill | https://github.com/jasonswett/llm-skills/blob/main/tdd/SKILL.md | Med-High | test-design.md reference, specification format |
| Previous `skills/tdd/tests.md` | local | High | Baseline test guidelines, good/bad examples |
| Previous `skills/tdd/mocking.md` | local | High | Baseline mocking guidelines |

## Adaptation Notes

- Moved from `skills/tdd/` to own skill to separate process (TDD) from enforcement (review)
- All examples kept as TypeScript/generic (not RSpec-specific)
- RSpec-specific patterns omitted: `.first`/`.last`, `described_class`, `have_current_path`, `instance_variable_set`, forward `let!` references
