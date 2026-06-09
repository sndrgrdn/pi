# Librarian Specification

## Intent

Maintain reusable local checkouts for remote git repositories. Resolve repo references to a stable cached checkout, refresh stale clones, and avoid repeated full clones.

## Scope

In scope:
- GitHub/GitLab/Bitbucket-style URLs, SSH URLs, `owner/repo`, and cached repo-name-only lookups.
- Cache reuse by canonical path and simple repo-name-only cache inspection.
- Safe fetch and fast-forward update when the checkout is clean.

Out of scope:
- Editing shared cached checkouts.
- Guessing an organization for repo-name-only input when no cached match exists.
- Resolving ambiguous repo-name-only matches without user choice.

## Users And Trigger Context

- Primary users: agents that need to inspect remote repositories as references.
- Common requests: "look at owner/repo", "see how this repo does it", "check opencode if already cloned".
- Should not trigger for: local-only filesystem search with no repository reference.

## Runtime Contract

- Required first action: classify input as qualified (`owner/repo`, URL, `git@`) or bare name (no `/`). Bare names **must** resolve via cache lookup (`find` + `git rev-parse` filter) before any `checkout.sh` call. Never pass a bare name to `checkout.sh`.
- Required outputs: use the resolved local path for reads/searches; ask the user when repo-name-only cache matches are ambiguous.
- Non-negotiable constraints: never pass bare names to `checkout.sh`; never clone without a qualified identity; do not edit the shared cache directly.
- Expected bundled files loaded at runtime: `checkout.sh`.

## Source And Evidence Model

Authoritative sources:
- `SKILL.md` runtime workflow.
- `checkout.sh` implementation.

Useful improvement sources:
- positive examples: successful cache reuse and update cases.
- negative examples: ambiguous repo names, stale or dirty checkouts, failed parses.
- validation results: shell syntax checks and temp-cache behavior tests.

Data that must not be stored:
- secrets
- customer data
- private URLs or identifiers not needed for reproduction

## Reference Architecture

- `SKILL.md` contains runtime routing and workflow guidance.
- `checkout.sh` contains deterministic parsing, clone, fetch, and fast-forward behavior for known remote identities.
- `references/`, `scripts/`, and `assets/` are currently unused.

## Validation

- Lightweight validation: `bash -n checkout.sh`.
- Deeper validation: manual cache inspection checks for repo-name-only exact match, ambiguity, and no-match behavior.
- Acceptance gates: repo-name-only input is resolved from cache before cloning; ambiguous or missing names prompt for user clarification.

## Known Limitations

- Repo-name-only lookup is cache-only.
- Ambiguity is reported by the agent after cache inspection; the agent must ask the user which candidate to use.

## Maintenance Notes

- Update `SKILL.md` when runtime behavior or user-facing workflow changes.
- Update `checkout.sh` when parsing, cache, clone, or refresh behavior changes.
- Update this `SPEC.md` when scope, trigger behavior, validation gates, or data-handling assumptions change.
