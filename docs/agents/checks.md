> Pi can create Checks. Ask it to create one for the review concern you want to enforce.

# Checks

Checks are Markdown-defined code review scans. Each Check gives a cheap review child one focused concern, such as error handling, boundary parsing, or worker safety. Check results are advisory and are merged into the main Code Review.

## Locations

Project Checks live in `.agents/checks/`. Pi searches the current directory and its ancestors, nearest first:

```text
my-project/
└── .agents/
    └── checks/
        ├── error-handling.md
        └── worker-safety.md
```

Global Checks apply to every reviewed repository and live in:

- `~/.pi/agent/checks/`
- `~/.agents/checks/`

Only direct `.md` children of a Check directory are discovered. When multiple Checks have the same name, the first one found wins. A nearer project Check can therefore override an ancestor or global Check.

## How Checks Work

1. `code_review` discovers the available Checks.
2. The main reviewer runs every discovered Check exactly once. It does not decide whether a Check applies.
3. Each Check child resolves the review diff and follows the instructions in its Markdown body.
4. A scoped Check scans only changed files matching its `globs`. If none match, it submits zero issues.
5. Check issues are merged mechanically into the final review. The summary records whether each Check ran, errored, or was not run.

Checks inspect changed lines only. Write instructions for one mechanical concern rather than asking a Check to perform a second general code review.

## File Format

A Check is a Markdown file with optional YAML frontmatter followed by its review instructions:

```markdown
---
name: worker-safety
description: Find unsafe background-job behavior
severity-default: high
globs:
  - app/workers/**
  - test/workers/**
---

Inspect changed worker files for retries that can duplicate side effects.
```

The Markdown body is required. Files with an empty body are ignored.

## Frontmatter

| Field | Required | Description |
|-------|----------|-------------|
| `name` | No | Check identity. Defaults to the filename without `.md`. |
| `description` | No | Short summary shown to the main reviewer. |
| `severity-default` | No | Default issue severity: `critical`, `high`, `medium`, or `low`. Defaults to `medium`. |
| `globs` | No | One glob string or a list of glob strings limiting which changed files the Check scans. |

Malformed `severity-default` or `globs` values stop discovery with an error naming the Check file. Other frontmatter fields are ignored.

## Glob Scoping

Use a string for one path pattern:

```yaml
globs: app/workers/**
```

Use a list for multiple patterns:

```yaml
globs:
  - app/workers/**
  - lib/jobs/**/*.ts
```

Globs are resolved relative to the Check's **home directory**:

- A Check in `<repo>/.agents/checks/` is relative to `<repo>`.
- A Check in `<repo>/packages/api/.agents/checks/` is relative to `<repo>/packages/api`.
- A global Check is relative to the root of the repository being reviewed.

An unscoped Check, with no `globs` field, applies to the entire diff. Scoping is performed by the Check child rather than by the review harness, so every discovered Check still runs.

## Authoring Guidelines

- Give the Check one precise, repeatable concern.
- State what constitutes an issue, not just the broad topic to inspect.
- Use `globs` only for path-shaped applicability. Keep semantic applicability in the instructions.
- Choose the severity that fits the usual impact. A submitted issue can override the default when its actual impact differs.
- Keep project Checks together in the repository root when possible; use nested Check directories when a package needs an independent home-relative scope.

The files in `agent/checks/` are working examples of focused Check instructions.
