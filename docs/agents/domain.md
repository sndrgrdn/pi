# Domain Docs

Single-context repo. One `CONTEXT.md` and `docs/adr/` at the repo root.

## Before exploring, read these

1. Read **`CONTEXT.md`** at the repo root for the domain glossary.
2. Check **`docs/adr/`** for architectural decisions relevant to the work.

If either does not exist, proceed silently.

## Use the glossary's vocabulary

When output names a domain concept—such as in an issue title, proposal, hypothesis, or test—use the term defined in `CONTEXT.md`. Avoid synonyms that the glossary explicitly rejects.

If a needed concept is absent, reconsider whether existing terminology applies or note a genuine domain-model gap.

## Flag ADR conflicts

If output contradicts an existing ADR, surface it explicitly rather than silently overriding it:

> _Contradicts ADR-0007 — but worth reopening because…_
