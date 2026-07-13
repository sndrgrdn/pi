---
name: fin-content
description: Review or author AI knowledge content — Intercom snippets, help-center articles, and Fin guidance. Use when auditing existing articles/snippets for AI readiness, when creating or editing knowledge-base content consumed by an AI agent, or when writing Fin guidance rules.
---

Knowledge content often has **two consumers**: Intercom's Fin AI Agent and a
project's own in-house RAG pipeline. Content must reach **readiness** for
every consumer it feeds.

Reference material (primary-sourced from Intercom/Fin docs, verified 2026-07):

- [SNIPPETS.md](SNIPPETS.md) — snippet mechanics, writing rules, checklist
- [ARTICLES.md](ARTICLES.md) — content types, 14-factor readiness framework, images, checklist
- [GUIDANCE.md](GUIDANCE.md) — guidance limits, rules, guidance vs procedures, checklist

## Universal constraints (every branch)

- Keep bodies generic and shareable — snippets and articles may be surfaced to any customer, so facts only, **no PII**.
- Keep canonical content in **one language**; Fin's real-time translation falls back to the default language only.
- Fin guidance lives only in Intercom, outside any sync or export. Policy that other consumers need goes in a snippet/article (facts) or in those consumers' prompts (behavior) — flag this to the user when it applies.
- Treat audience rules as Fin-side filtering only; write every piece as if all consumers can retrieve it.

## Start here (both branches)

**Discover project conventions.** Check the working repo for
knowledge-content conventions: `AGENTS.md`, `CONTEXT.md`, content directories
synced from Intercom, in-house retrieval pipelines and their content docs,
agent prompt files.

Done when: you can state where content lives in this project, which consumers
read it, and any project-specific constraints (chunking, retrieval, tenancy) —
or that none exist and Intercom is the only consumer.

Then pick the branch: **reviewing existing content** or **creating new
content**.

## Review branch

### R1. Scope the set

Pin exactly which items are under review — a single piece, a topic, or the
whole corpus. Done when: the item list is enumerated (paths or titles), with
each item's type (snippet / article / guidance) noted.

### R2. Read the references for every type in scope

Per the table above. For articles and snippets, the
[ARTICLES.md](ARTICLES.md) 14-factor table applies to both.

### R3. Audit every item

Per item, walk the type's checklist plus the 14 factors. Across items, also
check:

- **Duplicates** — same answer in more than one place (consolidate; duplicated
  sources confuse retrieval).
- **Contradictions** — conflicting facts, prices, limits between items.
- **Staleness** — numbers, plan names, UI paths, screenshots that no longer
  match the product; time-sensitive snippets past their shelf life.
- **Misplaced type** — snippets that should be public articles (equal
  weighting, better maintenance), guidance that encodes facts.

Done when: **every** item in scope has a verdict — pass, or flagged with the
specific factor/checklist item it fails — and no item was silently sampled
out. For large sets, report progress per batch rather than shrinking scope.

### R4. Report and fix

Deliver findings ranked by impact (customer-facing errors > retrieval problems
> style). For each flag: the item, the failing rule, and the concrete fix.
Apply fixes only on request, then re-run the failed checks on edited items.

Done when: the user has the ranked findings, and any applied fixes re-validate
clean.

## Create branch

### C1. Classify the content type

| Signal | Type |
|--------|------|
| Short answer, FAQ, temporary notice, internal-only fact | Snippet |
| How-to, feature guide, anything that can be public | Public article — preferred over snippets when public is possible (equal weighting, better maintenance) |
| Tone, policy, escalation, phrasing rule for Fin | Guidance (Intercom UI only) |

Done when: type named, with one line explaining why — including why a snippet
is *not* a public article, if applicable.

### C2. Read the matching reference

Per the table above.

### C3. Draft

Apply the reference rules. Keep every section **self-contained** — retrievable
alone, topic restated in its first sentence — and **chunk-safe**: H1–H3
headings only, one topic per section, exact numbers over vague quantities.
Honor any project constraints found at the start.

Done when: draft exists in the project's content location with conventions
matched (front matter, naming — copy a sibling file), or as a ready-to-paste
title + body block for Intercom-only content.

### C4. Validate against the checklist

Walk the checklist at the end of the matching reference file. Done when:
**every** item is explicitly pass or flagged with a reason — no item skipped.

### C5. Hand off with publishing warnings

State the applicable gotchas, minimally:

- Snippets: saving in Intercom publishes to Fin within ~10 minutes; there is no draft state; deletion is unrecoverable.
- If the repo mirrors Intercom content, confirm which side is authoritative before editing files.
- If the change encodes behavior another AI consumer needs: recommend the corresponding prompt change alongside.

Done when: the user has the content, the checklist result, and the warnings.
