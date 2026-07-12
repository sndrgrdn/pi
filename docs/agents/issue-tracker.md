# Issue tracker: Todo tool

Issues and PRDs for this repo are managed via the `todo` tool (file-based todos in `.pi/todos`).

## Conventions

- **Create an issue**: `todo create` with `title`, `body`, and `tags`
- **Read an issue**: `todo get` with the todo `id`
- **List issues**: `todo list` or `todo list-all` for all statuses
- **Add comments / notes**: `todo append` with the todo `id` and `body`
- **Update status or tags**: `todo update` with the todo `id`, `status`, and/or `tags`
- **Status values**: `open`, `done`
- **Triage state**: tracked via `tags` (see `triage-labels.md` for the tag strings)

## When a skill says "publish to the issue tracker"

Create a todo via `todo create`.

## When a skill says "fetch the relevant ticket"

Run `todo get` with the todo id. The user will normally pass the id directly.

## Wayfinding operations

Used by `/wayfinder`. The **map** and its tickets are todos in `.pi/todos`.

- **Map**: a todo tagged `wayfinder:map`; body holds Destination / Notes / Decisions-so-far / Not-yet-specified / Out-of-scope.
- **Child ticket**: a todo tagged `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`) plus `map:<map-id>`; body holds the question.
- **Blocking**: no native dependencies — fall back to a `Blocked by: TODO-xxx, TODO-yyy` line at the top of the ticket body. Unblocked when all listed todos are `done`.
- **Frontier**: `todo list`, filter to `map:<map-id>` tickets that are open, unblocked, and unclaimed.
- **Claim**: `todo claim` before any work — the claim *is* the assignment.
- **Resolve**: `todo append` the answer under `## Answer`, `todo update` status `done`, then append a one-line pointer to the map's Decisions-so-far.
