---
name: named-concept
description: Find new structures or modules named for intended use rather than the domain concept they represent.
severity-default: high
---

**Named concept** (Evans, ubiquitous language) — every new persisted structure or module centers a concept the domain can name, and established vocabulary — the repo's domain doc or the industry's (a trace, a snapshot, a ledger, a policy) — outranks an invented label. A structure named for its intended use rather than its concept is the finding: junk-drawer names describing purpose instead of what the data *is* (`debug_data`, `metadata`, `extra_info`, `*_stuff`) are a blank concept wearing a label. → Name what the data actually is and the module that should center it. **Presumptive blocker.** Evidence: the unnamed structure (file:line) plus the established term it evades.
