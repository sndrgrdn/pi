# Fin Guidance

Primary sources: [Provide Fin AI Agent with specific guidance](https://fin.ai/help/en/articles/13975768-provide-fin-ai-agent-with-specific-guidance),
[Fin Guidance best practices](https://fin.ai/help/en/articles/10644781-fin-guidance-best-practices),
[When to use Fin Guidance vs. Procedures](https://www.intercom.com/help/en/articles/14623785-when-to-use-fin-guidance-vs-procedures).

## Mechanics

- Natural-language instruction shaping tone, policies, and conversation
  handling — separate from knowledge content. Categories: Communication style,
  Context and clarification, Content and sources, Spam, Other.
- **Limits: 1,000 pieces per workspace; 2,500 characters each.** Title required.
- Can target audiences and interpolate attributes (`{First name}`) — but
  attributes aren't always applied; for strict targeting use audience rules.
- `@` references to Fin-enabled articles/snippets work only in **Content and
  sources** (must include at least one reference). "Don't use [article]"
  phrasing may be ignored — remove the article from Fin or restrict its
  audience instead.
- Guidance exists only inside Intercom — it is not part of any content sync or
  export.

## Do

- **Start with the outcome**; work backward into clear, actionable steps.
- **Speak directly to Fin** in second person ("Never tell the customer to…").
- **Simple, precise language** — write as if training a new support agent.
- **If / when / then** conditions with concrete examples.
- **One objective per piece**; split tone, clarification, and escalation into
  separate entries in their proper categories.
- **Specific titles** — "Greeting for VIP Customers", not "Greeting".
- **Content-and-sources guidance** when Fin must prefer a source: "If the
  customer asks about refunds, always refer to [article]."
- **Test in Preview** (impersonating users/leads) before enabling; run the
  built-in Optimize assistant (checks ambiguity, redundancy, contradiction).
- Audience rules filter *when* guidance applies; attributes customize *what*
  it says.

## Don't

- **Don't ask Fin to share external resources "if available"** — it can't
  verify existence and may hallucinate links. Embed real URLs in
  articles/snippets and point at them with content guidance.
- **Don't chain guidance** — each piece is evaluated independently.
- **Don't offer escalation as a blanket rule** — make it situational.
- **Don't mis-categorize** — guidance must be in the right category to work.
- **Don't use guidance for step-by-step flows.** Guidance is applied *while*
  Fin generates an answer — multi-step or conditional instructions may be
  partially applied, out of order, or skipped. Use a Procedure.

## Guidance vs content vs procedures

- **Content first**: Fin always answers from content; guidance only refines
  phrasing. Fix the article before writing guidance about it.
- Layering: Content → answer the question; Guidance → targeted phrasing
  tweaks; Procedures → structured multi-step interactions.
- **Global guidance can fire mid-procedure** and leak information ahead of the
  intended step — audit broad rules; narrow with audiences or move the logic
  into the procedure step.
- Procedure instructions: one step = one meaningful unit of work; max one
  data-connector call per step; plain concrete verbs (ask, check, send) over
  abstract ones (validate, facilitate). "If a human with no context can't
  understand your instructions, Fin won't either."

## Advanced techniques

- CAPITALS for critical rules: "NEVER apologize to customers."
- Dictate an exact phrase, or describe the information and let Fin phrase it.
- Formatting instructions work ("…Make it bold!").
- Ending guidance with a question makes Fin ask it instead of its default
  feedback question — but this may reduce confirmed resolutions.
- Prefer the global answer-length setting; add Communication-style guidance
  only for stricter, audience-specific limits.

## Checklist

- [ ] Correct category; specific title
- [ ] Single objective; second-person, if/when/then phrasing; concrete example
- [ ] ≤2,500 characters; no reliance on other guidance firing
- [ ] No instructions to share unverifiable external resources
- [ ] Not a multi-step flow (that's a Procedure)
- [ ] Ran the Optimize assistant; tested in Preview; then Save + Enable
- [ ] Policy other AI consumers also need → mirrored as a snippet/article or a
      prompt change (guidance never leaves Intercom)
