# Checks

Checks are Markdown-defined scans run during code review. Put project Checks in `.agents/checks/`; nested Check directories remain supported.

## Frontmatter

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | No | Check identity; defaults to the filename without `.md`. |
| `description` | No | Short summary shown to the main reviewer. |
| `severity-default` | No | Default issue severity: `critical`, `high`, `medium`, or `low`; defaults to `medium`. |
| `globs` | No | One glob string or a list of glob strings limiting the changed files scanned. |

Globs are resolved relative to the Check's home directory. For a root-level or global Check, that is the reviewed repository root; for a nested Check, it is the directory containing `.agents`. A scoped Check submits zero issues when no changed files match. Without `globs`, a Check scans the entire diff.

## Example

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
