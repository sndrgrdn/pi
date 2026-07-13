# Triage Labels

The skills speak in canonical category and state roles. This file maps those roles to the exact GitHub label strings used by `sndrgrdn/pi`.

## Category roles

Every triaged issue carries exactly one category label.

| Canonical role | GitHub label | Meaning                    |
| -------------- | ------------ | -------------------------- |
| `bug`          | `bug`        | Existing behavior is broken |
| `enhancement`  | `enhancement` | New feature or improvement  |

## State roles

Every triaged issue carries exactly one state label.

| Canonical role     | GitHub label       | Meaning                                  |
| ------------------ | ------------------ | ---------------------------------------- |
| `needs-triage`     | `needs-triage`     | Maintainer needs to evaluate this issue  |
| `needs-info`       | `needs-info`       | Waiting on reporter for more information |
| `ready-for-agent`  | `ready-for-agent`  | Fully specified, ready for an AFK agent  |
| `ready-for-human`  | `ready-for-human`  | Requires human implementation            |
| `wontfix`          | `wontfix`          | Will not be actioned                      |

When a skill names a canonical role, apply the corresponding exact GitHub label.
