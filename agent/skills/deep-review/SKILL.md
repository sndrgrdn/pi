---
name: deep-review
description: Selectable panel review of a branch — Design, Craft, Fitness, and Stability judges convicting on evidence, gated mechanically.
disable-model-invocation: true
---

Deep review of the diff between `HEAD` and a fixed point. Four **judges** are available, each answering one question in an isolated task run. Use the subset named by the caller; default to all four. This session **dispatches** — it gathers the evidence, briefs the selected judges, and applies the gate to their reports; it never judges.

- **Design** — are these the right modules? (reconstruction)
- **Craft** — is the code inside built right? (rules + smells)
- **Fitness** — should this exist, in this shape, at all? (prosecution)
- **Stability** — what does it break? (blast radius)

A requested subset defines the review's scope. Unselected judges are omitted, not missing; a selected judge that fails to report is missing.

## Severity

Stated once here; pasted verbatim into every judge's prompt.

> Rules tagged **presumptive blocker** admit five states only: *blocking finding*, *clear*, *inapplicable*, *skipped*, or *unchecked*. Rule hit + evidence bar met ⇒ the finding is blocking; justification rides as Brady disclosure, never as a downgrade. Every blocker carries an **evidence bar** — the artifact that must exist before the finding may be filed (a module table row, a cut-line plan, a traced dependent, a quoted premise). A finding is a piece of evidence, or it doesn't exist.
>
> Judges never rule on defenses. Exculpatory material found in the diff or commit messages — a hunk or message that justifies the code as written — is attached to the finding as a verbatim quote, unruled (**Brady disclosure**); the human is the appeals court. The PR description and its comments are **testimony**: quotable as disclosure, never as defense.

## Process

### 1. Pin the fixed point

The fixed point is whatever the user supplied — commit SHA, branch, tag, `HEAD~5`. Unspecified: `main`.

Capture once: `git diff <fixed-point>...HEAD` (three-dot, against the merge-base) and `git log <fixed-point>..HEAD --oneline`.

Done when the ref resolves (`git rev-parse <fixed-point>`) and the diff is non-empty — a bad ref or empty diff fails here, not inside the selected judges.

### 2. Build the census

Facts only — file lists, log lines, quotes. A verdict in the census pre-judges the panel; leave every judgment to the seats.

- **Stated purpose** — quoted from the PR description (`gh pr view`), issue references in the commit messages (fetched via the workflow in `docs/agents/issue-tracker.md` — missing? run `/setup-matt-pocock-skills`), or, absent both, the commit messages. This is what every hunk must trace to.
- **Premises** — the stated-purpose source's concrete claims ("nothing does X today", numbers, guarantees), extracted as a numbered list of falsifiable hypotheses.
- **Siblings** — for each directory the diff touches or creates: list what already lives there and, one line each, what it does.
- **Trajectory** — `git log --oneline` (recent history) for the sibling areas: which neighboring machinery is recently invested-in, which is long untouched.
- **House record** — the domain doc per `docs/agents/domain.md` (`CONTEXT.md` at the repo root: bounded-context vocabulary — quote the sections the diff's domain touches), `docs/adr/` titles with any ADR naming the diff's concepts quoted in full, plus every standards doc at the repo root and under `docs/` (`CODING_STANDARDS.md`, `CONTRIBUTING.md`, agent rules files). Where two house records conflict (ADR vs domain doc), quote both — the conflict is a fact.
- **Measure** — `git diff <fixed-point>...HEAD --stat`, with hand-written changed lines separated from lockfiles, generated files, and snapshots.

Done when all six entries exist and contain only facts.

### 3. Convene the judges

Read the selected judges' rubrics now — `references/design.md`, `references/craft.md`, `references/fitness.md`, or `references/stability.md`. Each is complete and goes verbatim into its judge's prompt.

Convene the selected judges as separate `task` calls in parallel, scoped to review and a judge report. Run Design and Fitness with `mode: "high"`; run Craft and Stability with `mode: "medium"`. Charitable drift lives in the judging seats, so reserve the strongest reasoning for Design and Fitness.

Every prompt carries the diff command, commit list, Severity block above, its rubric, this reporting contract, and its evidence packet:

> Every finding is **forensic**: decisive evidence traced end-to-end — cite file:line for source-backed claims and include the rubric's required artifact. Verify any claim you can check in-repo before reporting it. Blocking status follows mechanically from the Severity block; label everything else **non-blocking**. Order blocking findings first, then non-blocking findings strongest first. Close with a proof-obligation ledger: report every rubric rule as *finding* (with evidence and blocking status), *clear* (checked, with evidence), *inapplicable* (the diff never touches the concern), *skipped* (the named standard or tool that owns enforcement, with evidence), or *unchecked* (what could not be verified and why). Findings under 500 words; the ledger may be terse lines.

- **Design** — stated purpose, siblings, and house record.
- **Craft** — siblings and house record, including the standards docs' contents.
- **Fitness** — the census in full.
- **Stability** — stated purpose and premises.

Done when every selected judge is spawned in one call, each prompt carrying the five shared items and its complete evidence packet.

### 4. Report and gate

The selected judges' full task reports are the **audit trail**. Keep them there; surface any selected seat's full report when the user asks. The default response is a **decision brief** targeting 1,000 words:

1. `# Deep Review — PASS|FAIL|INCOMPLETE` for the full panel, or `# Deep Review (Design + Craft) — PASS|FAIL|INCOMPLETE` for a subset — the single scoped verdict.
2. `## Charges` — every distinct blocking charge, each under 100 words: name the filing and corroborating seats, cite the decisive evidence (file:line where source-backed), state the required remedy, and compress Brady disclosure to one sentence. Write `None` when there are no blockers.
3. `## Unchecked obligations` — every unchecked presumptive-blocker rule, grouped by seat with the reason. Omit this section when none exist.
4. `## Seat summary` — one table row per selected seat: blocking count, non-blocking count, and the first finding in that judge's order, or `—` when it filed none.
5. `## Judgment calls` — the first three non-blocking findings per selected seat in judge order, one line each. When a seat has more, append `<N> more in the full <Seat> report.` Evidence stays in the audit trail.
6. `## Full reports` — state that the complete reconstruction tables, premise tables, evidence, disclosures, and proof-obligation ledgers remain available by seat on request.

Merge findings only when they share one root cause and one required remedy, naming every corroborating seat. Findings on the same artifact with distinct causes or remedies remain distinct charges. The charge count, not the raw finding count, is the verdict's weight.

Before gating, audit blocker provenance mechanically: every blocking finding must name a rubric rule explicitly tagged **presumptive blocker** and show that rule's evidence bar is met. A finding under an untagged rule is non-blocking regardless of the judge's label.

The gate resolves over the selected judges, in order: **FAIL** when any blocking finding exists; otherwise **INCOMPLETE** when any presumptive-blocker rule is unchecked; otherwise **PASS**. A missing selected judge leaves all of its presumptive-blocker rules unchecked. Charge completeness outranks the word target: when the complete charge list would exceed it, compress each charge to one line and leave supporting detail in the audit trail.

Done when every charge traces to a tagged presumptive-blocker rule with its evidence bar met, every blocking finding maps to a charge, every unchecked presumptive-blocker rule appears under Unchecked obligations, every selected seat has a summary row, every omitted non-blocking finding is included in its seat's count, and the headline names the selected scope and matches its gate.
