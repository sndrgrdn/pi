# pstack model configuration. One line per role. Delete a line to fall back to the skill default.
# `inherit-parent` or `auto` as a value: the role runs on the parent chat model (omit `model`). Alias entries in a panel list still count toward its fan-out.
# budget: medium (high)
feature, refactoring: anthropic/claude-opus-5-5:high
bug-fix: anthropic/claude-opus-5-5:high
perf-issue: anthropic/claude-opus-5-5:high
hillclimb: anthropic/claude-opus-5-5:high
judgment and prose: anthropic/claude-opus-5-5:high
hardest tasks: anthropic/claude-opus-5-5:high
how explorer: anthropic/claude-sonnet-5-5:high
how explainer: anthropic/claude-opus-5-5:high
why investigators: anthropic/claude-sonnet-5-5:high
why synthesizer: anthropic/claude-opus-5-5:high
reflect tooling: anthropic/claude-sonnet-5-5:high
reflect judgment, divergent, synthesizer: anthropic/claude-opus-5-5:high
arena runners: anthropic/claude-opus-5-5:high, anthropic/claude-sonnet-5-5:high
arena cross-judge pool: anthropic/claude-opus-5-5:high, anthropic/claude-sonnet-5-5:high
swarm workers: anthropic/claude-sonnet-5-5:high
architect runners: anthropic/claude-opus-5-5:high, anthropic/claude-sonnet-5-5:high
interrogate reviewers: anthropic/claude-opus-5-5:high, anthropic/claude-sonnet-5-5:high
