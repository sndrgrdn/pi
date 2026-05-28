---
name: thermos
description: >
  Launch both thermo-nuclear review subagents in parallel, then synthesize
  their findings. Use for thermos, double thermo review, or combined
  bug/security and code-quality branch audits.
disable-model-invocation: true
---

# Thermos

Run the two thermo review passes as parallel subagents, then synthesize their results.

## Workflow

### 1. Determine scope

Identify the review target from the user request, PR URL, current branch, or relevant changed files.

Default diff base: `main`. Override if the user specifies a different base.

### 2. Launch both subagents in parallel

Each subagent has full repo access (tools, bash, git, gh). They gather their own diff and file contents.

Always include in the task: the diff base, any user-provided scope or context, and a request to return prioritized findings with file references and evidence.

```
subagent({
  tasks: [
    {
      agent: "thermo-nuclear-review-subagent",
      task: "Review the current branch against <base>. Return prioritized findings with file:line evidence. <any additional scope/context from the user>"
    },
    {
      agent: "thermo-nuclear-code-quality-review-subagent",
      task: "Review the current branch against <base>. Return prioritized findings with file:line evidence. <any additional scope/context from the user>"
    }
  ]
})
```

What each subagent covers:

- **thermo-nuclear-review-subagent** — bugs, breakages, security, devex regressions, feature-flag leaks, and other branch-audit risks.
- **thermo-nuclear-code-quality-review-subagent** — maintainability, structure, file-size growth, spaghetti, abstractions, and codebase-health risks.

### 3. Synthesize

After both subagents finish:

- **Findings first.** Lead with the highest-signal issues.
- **Deduplicate.** Weight overlapping findings (found by both reviewers) more heavily.
- **Resolve disagreements** with your own judgment.
- **Keep it brief.** If individual summaries are already visible, surface the unified verdict and highest-signal findings only — do not restate them wholesale.
- **Flag uncertainty** where reviewers disagree or evidence is inconclusive.

### Partial results

If one subagent fails or errors out, synthesize from the one that succeeded. Note the missing perspective and which review pass was lost.
