# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues in `sndrgrdn/pi`. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, including labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments` with appropriate label and state filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`.
- **Apply or remove labels**: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- **Close an issue**: `gh issue close <number> --comment "..."`.

Infer the repository from `git remote -v`; `gh` does this automatically inside this clone.

## Pull requests as a triage surface

**PRs as a request surface: no.** `/triage` covers GitHub Issues only. Pull requests remain outside its discovery queue, though an explicitly named PR may still be inspected when requested.

## Skill conventions

- When a skill says **publish to the issue tracker**, create a GitHub issue.
- When a skill says **fetch the relevant ticket**, run `gh issue view <number> --comments`.

## Wayfinding operations

Used by `/wayfinder`. The map is one issue with child issues as tickets.

- **Map**: an issue labelled `wayfinder:map`, holding Notes, Decisions-so-far, Not-yet-specified, and Out-of-scope.
- **Child ticket**: a GitHub sub-issue labelled `wayfinder:<type>` (`research`, `prototype`, `grilling`, or `task`). Where sub-issues are unavailable, use a task-list link and put `Part of #<map>` at the top of the child body.
- **Blocking**: use GitHub native issue dependencies. Where unavailable, use a `Blocked by: #<n>, #<n>` line at the top of the child body.
- **Frontier**: open map children with no open blocker and no assignee, in map order.
- **Claim**: `gh issue edit <n> --add-assignee @me` before work; the claim is the assignment.
- **Resolve**: comment with the answer, close the child, then append a one-line context pointer to the map's Decisions-so-far.

Existing `.pi/todos` files are archival. New issues and PRDs belong in GitHub Issues.
