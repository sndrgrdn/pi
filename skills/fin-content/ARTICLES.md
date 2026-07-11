# Articles and the readiness framework

Primary sources: [Optimizing content for Fin](https://www.intercom.com/help/en/articles/7860255-optimizing-content-for-fin),
[Add your content for Fin AI Agent](https://www.intercom.com/help/en/articles/7837514-add-your-content-for-fin-ai-agent),
[Using images and GIFs in Fin AI Agent replies](https://www.intercom.com/help/en/articles/13463564-using-images-and-gifs-in-fin-ai-agent-replies),
[Set up Fin AI Agent's multilingual support](https://www.intercom.com/help/en/articles/8322387-set-up-fin-ai-agent-s-multilingual-support).

## Content types

- **Public article** — product info, how-tos, FAQs; citable in Fin answers;
  doesn't need to be in the Help Center to be Fin-enabled (an unlisted public
  article + internal-tester audience is the recommended pre-launch validation
  path).
- **Internal article** — Intercom-native, never published to the Help Center;
  for Fin/Copilot only. Internal articles synced from Confluence/Guru/Notion
  are read-only (24 h resync); imported ones become editable and stop tracking
  the source.
- **Uploaded documents** (PDF/DOCX) — text scraped, tables readable; no
  multi-column/encrypted files; 100 MB and 100 docs/workspace limits; private
  source.
- **Website sync** — weekly; top-level domain works best; content inside
  accordions/tabs is invisible unless the sync is configured to click them
  open; max 10 sources, 3,000 pages each.

## The 14-factor readiness framework

Applies to all AI-enabled content (articles, snippets, synced sources).

| # | Factor | Rule |
|---|--------|------|
| 1 | Jobs to be done | Opening paragraph states what the reader will accomplish. |
| 2 | Disambiguation | Every reference self-descriptive; restate the subject, never bare "it". |
| 3 | Self-contained sections | Every section makes sense retrieved in isolation ("radio interview" rule). |
| 4 | Semantic chunk boundaries | H1–H3 headers divide content into focused single-topic sections. |
| 5 | Query-answer symmetry | Headings mirror how a customer would phrase the question; restate the question in the answer. |
| 6 | Structured enumeration | Steps = numbered lists; options = bullets; "the following:" must be followed by a list. |
| 7 | Instruction completeness | Include what happens after the final step (confirmations, expected outcomes). |
| 8 | Numerical clarity | Exact values, never "a few minutes". Don't make the AI do math — state totals with worked examples. |
| 9 | Defined terms | Spell out acronyms and product terms on first use. |
| 10 | Audience specification | State who the content is for and what access/plan/permissions are required. |
| 11 | Limitations and workarounds | Document limitations specifically, with workarounds — prevents misleading answers. |
| 12 | Entity distribution | Repeat product/feature names throughout; sections mentioning only "the button" are invisible to retrieval. |
| 13 | Context in tables | Every table/standalone block gets an introductory sentence. |
| 14 | Visual content and alt text | Alt text on every image; always pair images with step-by-step text. |

Also: Fin may not capture HTML headings reliably — restate each section's
topic in its opening sentence. Avoid bare "yes"/"no" answers; use full
sentences that disambiguate.

## Images

- Fin includes up to 3 existing images/GIFs per answer; it never generates
  images. Sources: Help Center articles, website sync, PDFs, imported
  Salesforce/Zendesk/Freshdesk. **Not snippets, Box, or Document360.**
- Selection uses **the image content and surrounding text only — not alt text
  or metadata**. Place each screenshot immediately next to the step it
  illustrates; one screenshot per step, not composites; GIFs for navigation
  flows; annotate key UI elements.

## Language

- Fin searches content in the language the question was written in; without
  real-time translation, a language mismatch means no answer. Real-time
  translation falls back to the configured **default language only** — keep
  canonical content in one language.

## Checklist

- [ ] Opening paragraph states what the reader will accomplish
- [ ] H1–H3 headings, one topic per section, each section self-contained
      (topic restated in the section's first sentence)
- [ ] Sections roughly under 2,000 characters (chunk-safe for RAG pipelines)
- [ ] Numbered lists for steps (complete through confirmation), bullets for options
- [ ] Acronyms/product terms defined on first use; feature names repeated throughout
- [ ] Plan/permission requirements stated; limitations documented with workarounds
- [ ] Every table introduced by a sentence; every image paired with text steps,
      alt text, and placed next to the step it illustrates
- [ ] Exact numbers everywhere; no unresolved math
- [ ] Written in the canonical content language
- [ ] All 14 readiness factors pass
