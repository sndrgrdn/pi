# Pi Harness

Personal Pi configuration: constrained agent tooling, model profiles, specialist agents, skills, and terminal UI.

## Language

### Code review

**Code Review**:
A fast, tool-driven review of an explicit diff — one main reviewer plus applicable Checks, run on request.
_Avoid_: quick review, mini review

**Deep Review**:
The heavyweight branch gate — a panel of Judges convened over a pinned review range, resolved mechanically to PASS/FAIL/INCOMPLETE.

**Judge**:
A holistic quality question answered from gathered evidence in an isolated run, gated by a blocking policy.
_Avoid_: seat (informal alias), reviewer

**Check**:
A mechanical pattern scan over the changed lines of a diff, defined in a Markdown file and run by a cheap model; advisory, never gated. Optionally scoped by globs; an unscoped Check applies to every diff.
_Avoid_: rule, lint

**Comment**:
A single review finding tied to a file and line range, carrying severity and an optional fix.
_Avoid_: issue, finding (in code-review output)
