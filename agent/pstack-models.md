# pstack model configuration. One line per role. Delete a line to fall back to the skill default.
# `inherit-parent` or `auto` as a value: the role runs on the parent chat model (omit `model`). Alias entries in a panel list still count toward its fan-out.
# Effort: never raise an Anthropic role above high. When high is not enough, move up one model (Sonnet to Opus, Opus to Fable) and start it one level lower. Fable at high is the ceiling.
# defaults: 3
# budget: small (medium)
feature, refactoring: anthropic/claude-opus-5-5:medium
bug-fix: anthropic/claude-opus-5-5:medium
perf-issue: anthropic/claude-opus-5-5:medium
hillclimb: anthropic/claude-fable-5-2:medium
judgment and prose: anthropic/claude-opus-5-5:medium
arena runners: anthropic/claude-fable-5-2:medium, anthropic/claude-opus-5-5:medium, anthropic/claude-sonnet-5-5:medium
arena cross-judge pool: anthropic/claude-opus-5-5:medium, anthropic/claude-sonnet-5-5:medium
swarm workers: anthropic/claude-sonnet-5-5:medium
interrogate reviewers: anthropic/claude-fable-5-2:medium, anthropic/claude-opus-5-5:medium, anthropic/claude-sonnet-5-5:medium
