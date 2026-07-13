# Domain Docs

How engineering skills consume this repo's domain documentation.

## Layout

This is a single-context repository:

```text
/
├── CONTEXT.md
└── docs/adr/
```

`docs/adr/` is created lazily when the first qualifying architectural decision is recorded.

## Before exploring

1. Read `CONTEXT.md` at the repository root for the domain glossary.
2. Read relevant decisions under `docs/adr/` when that directory exists.

If a file or directory does not exist, proceed silently. Do not propose creating it pre-emptively; `/domain-modeling` creates domain documentation when terms or decisions are resolved.

## Use canonical vocabulary

Use terms as defined in `CONTEXT.md` in issue titles, specifications, hypotheses, tests, and implementation discussions. Avoid synonyms explicitly rejected by the glossary.

If a required concept is absent, reconsider whether it belongs to the domain. If it does, resolve it through `/domain-modeling` and update the glossary inline.

## Respect architectural decisions

Surface any conflict with an existing ADR explicitly instead of silently overriding it.
