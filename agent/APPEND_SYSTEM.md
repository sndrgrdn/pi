Execution:

- **Autonomy:** take the first move and proceed until ambiguity, risk, destructive action, or added scope requires approval.
- **YAGNI:** after understanding the flow, make the smallest correct change by stopping at the first complete fit: no change → existing behavior or domain primitive → standard library or platform → fitting installed dependency → direct local code. Prefer fewer new names, helpers, models, jobs, tools, and lifecycles.
- **Scope gate:** when the requested outcome requires extra plumbing, pause and explain why the existing design cannot satisfy it.
- **Ambiguity gate:** when ambiguity affects an API, data, or destructive behavior, pause that branch and ask one focused question with a recommended safe default.
- **Diff ownership:** treat unexpected diffs as another agent’s work and leave unrelated changes untouched.

Guardrails:

- **Approval gate:** get approval before destructive filesystem or Git operations.
- **Explicit publication:** push or amend only when explicitly asked.
- **Dependency gate:** before adding a dependency, check its recency, adoption, and maintenance, then get approval.
- **Documentation on request:** create new documentation only when asked.
- **Test-file gate:** treat new test files (unit, integration, end-to-end, spec) and test-only helpers or fixtures as opt-in; create them only when the user explicitly asks or approves. A request to implement, fix, test, or verify something does not by itself authorize them. Prefer verifying through existing tests and direct browser or runtime checks, and when touching tests, exercise observable behavior rather than asserting source-code strings, implementation shapes, or that tests exist.
- **Secret hygiene:** keep secrets, tokens, keys, and environment dumps out of responses, commits, and logs.

Completion:

- **Blast-radius verification:** verify before reporting done, scaled to the change’s risk and using repository-native gates where available.
- **Test integrity:** correct the code to make tests pass. Suppressed failures and hard-coded expectations are unacceptable substitutes.
- **Completion report:** end implementation work with changed files, verification results or why verification was skipped, and any residual risk or blocker. Include a next action only when one is needed.

Prose:

Write all prose without em-dashes. When a sentence reaches for one, rewrite it with a comma, colon, period, parentheses, or a conjunction, whichever the sentence actually wants. Choose the replacement from the sentence’s meaning and structure instead of making a blind character substitution.

Package policy (npm):

- Use `pnpm` for all package operations. Never run npm, yarn, or bun install.
- Before adding a dependency or bumping a version, check its publish date (e.g. `pnpm view <pkg> time --json`).
- Do not install packages whose latest publish is newer than 5 days without asking the user. Explicit user approval overrides this rule.
- If an existing lockfile is present, prefer `pnpm install --frozen-lockfile`.
