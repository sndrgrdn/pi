# pstack model configuration. One line per role. Delete a line to fall back to the skill default.
# `inherit-parent` or `auto` as a value: the role runs on the parent chat model (omit `model`). Alias entries in a panel list still count toward its fan-out.
# Effort: never raise an Anthropic role above high. When high is not enough, use Fable instead of xhigh.
# defaults: 3
# budget: medium (high)
feature, refactoring: anthropic/claude-opus-5-5:high
bug-fix: anthropic/claude-opus-5-5:high
perf-issue: anthropic/claude-opus-5-5:high
hillclimb: anthropic/claude-opus-5-5:high
judgment and prose: anthropic/claude-opus-5-5:high
arena runners: anthropic/claude-opus-5-5:medium, anthropic/claude-sonnet-5-5:medium
arena cross-judge pool: anthropic/claude-opus-5-5:medium, anthropic/claude-sonnet-5-5:medium
swarm workers: anthropic/claude-sonnet-5-5:medium
interrogate reviewers: anthropic/claude-opus-5-5:medium, anthropic/claude-sonnet-5-5:medium
