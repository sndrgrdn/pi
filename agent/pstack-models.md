# pstack model configuration. One line per role. Delete a line to fall back to the skill default.
# `inherit-parent` or `auto` as a value: the role runs on the parent chat model (omit `model`). Alias entries in a panel list still count toward its fan-out.
# budget: custom (each role's effort follows the tuin-mode model sheet)
# Each role line gives the starting model and effort. The effort range is `low`, `medium`, `high`.
# When a result falls short, take these steps in order: give the subagent a check it can run itself (a test, a build, a script); raise effort one step, up to `high`; use the next model up, one effort step below the one that fell short.
# The models rank haiku < sonnet < opus < fable. The next model up from opus is the `hardest tasks` line.
# Lower effort one step for routine work in a role. When results can be checked automatically, run fan-out work one step lower and rerun only the failures one step higher.
feature, refactoring: anthropic/claude-opus-5-5:medium
bug-fix: anthropic/claude-opus-5-5:medium
perf-issue: anthropic/claude-opus-5-5:high
hillclimb: anthropic/claude-opus-5-5:medium
judgment and prose: anthropic/claude-opus-5-5:high
hardest tasks: anthropic/claude-fable-5-2:medium
how explorer: anthropic/claude-haiku-5-5:medium
how explainer: anthropic/claude-opus-5-5:high
why investigators: anthropic/claude-sonnet-5-5:medium
why synthesizer: anthropic/claude-opus-5-5:high
reflect tooling: anthropic/claude-sonnet-5-5:medium
reflect judgment, divergent, synthesizer: anthropic/claude-opus-5-5:high
arena runners: anthropic/claude-opus-5-5:high, anthropic/claude-fable-5-2:medium
arena cross-judge pool: anthropic/claude-opus-5-5:high, anthropic/claude-fable-5-2:medium
swarm workers: anthropic/claude-opus-5-5:medium
architect runners: anthropic/claude-opus-5-5:high, anthropic/claude-fable-5-2:medium
interrogate reviewers: anthropic/claude-opus-5-5:high, anthropic/claude-fable-5-2:medium
