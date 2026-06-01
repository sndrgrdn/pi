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
