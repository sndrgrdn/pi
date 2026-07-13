# Snippets

Primary sources: [Create and manage snippets](https://www.intercom.com/help/en/articles/8074407-create-and-manage-snippets),
[Content types and when to use them](https://fin.ai/help/en/articles/13975810-content-types-and-when-to-use-them).

## Mechanics

- Private, AI-only content: used by Fin AI Agent and Copilot to improve answer
  quality; customers never see a link to a snippet — only "AI answers are
  generated based on both public and private sources provided by [company]".
- **No draft state.** Saving a snippet enables it for Fin immediately (live
  within ~10 minutes). For a review workflow: save, then immediately toggle
  **off** "Available for Fin AI Agent".
- **Deleted snippets cannot be restored.**
- Text only — no images. Snippets are also excluded from Fin's image answers.
- Default audience is "Everyone"; Fin respects audience rules per snippet.
- Snippets and public articles are **weighted equally** in Fin's answers;
  public articles scale better — prefer an article when the content can be
  public. Snippets suit brief answers, temporary bug notices, and
  time-sensitive information that will later be deleted.

## Writing rules

1. **Avoid ambiguity.** Title explicitly names the product/feature/service;
   body leaves no room for misinterpretation.
2. **No PII in the body** — snippet content may be shared with any customer.
3. **Restate the question in the body.** Title "How to reset your password" →
   body opens "If you're looking for instructions on how to reset your
   password…". Improves question↔snippet matching.
4. **Use headers for structure** in snippets over ~200 words: H1/H2 sections,
   each header summarizing what follows.
5. **Use lists, not paragraphs** — Fin processes structured, concise points
   better.
6. **Pack the title with question variations**, separated by `/`, `?`, or `,`
   — e.g. "How to reset password / Forgot password / Password recovery".
   Titles aren't visible to customers, so make them long and descriptive.
7. **One topic per snippet.** Small facts without an obvious home belong in a
   snippet, retrievable and usable in isolation.
8. **Audit and consolidate** duplicate or outdated snippets regularly.

No hard character limit for snippet bodies is documented in primary sources.

## Checklist

- [ ] Title names the exact feature + 2–3 phrasing variations (`/`-separated)
- [ ] Body restates the question/topic in its first sentence
- [ ] One topic only; no PII; no images
- [ ] Lists over paragraphs; headers if over ~200 words
- [ ] Exact numbers, dates, limits — no "a few days"
- [ ] Not duplicating an existing snippet or article (consolidate instead)
- [ ] Could this live in a public article instead? (Equal weighting; articles scale better)
- [ ] Time-sensitive? Note when it should be deleted
- [ ] Publishing plan: saving goes live in ~10 min — toggle Fin off first if it needs review
