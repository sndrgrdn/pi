# pstack model configuration. One line per role. Delete a line to fall back to the skill default.
# `inherit-parent` or `auto` as a value: the role runs on the parent chat model (omit `model`). Alias entries in a panel list still count toward its fan-out.
# budget: medium (high)
feature, refactoring: meridian/claude-sonnet-5-5:high
bug-fix: meridian/claude-sonnet-5-5:high
perf-issue: meridian/claude-sonnet-5-5:high
hillclimb: meridian/claude-sonnet-5-5:high
judgment and prose: meridian/claude-opus-5-5:high
hardest tasks: meridian/claude-opus-5-5:high
how explorer: meridian/claude-sonnet-5-5:high
how explainer: meridian/claude-opus-5-5:high
why investigators: meridian/claude-sonnet-5-5:high
why synthesizer: meridian/claude-opus-5-5:high
reflect tooling: meridian/claude-sonnet-5-5:high
reflect judgment, divergent, synthesizer: meridian/claude-opus-5-5:high
arena runners: meridian/claude-opus-5-5:high, meridian/claude-fable-5-1:high
arena cross-judge pool: meridian/claude-opus-5-5:high, meridian/claude-fable-5-1:high
swarm workers: meridian/claude-sonnet-5-5:high
architect runners: meridian/claude-opus-5-5:high, meridian/claude-fable-5-1:high
interrogate reviewers: meridian/claude-opus-5-5:high, meridian/claude-fable-5-1:high
