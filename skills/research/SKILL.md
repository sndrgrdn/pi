---
name: research
description: Research a question against primary sources and capture the findings as a cited Markdown file in the repo. Use when the user wants a topic researched or docs/API facts gathered.
---

Delegate the research to a subagent — `subagent({ agent: "general", task: "..." })` — so the reading happens in an isolated context instead of polluting yours. It starts blank: give it the full question and the instructions below.

Its job:

1. Investigate the question against **primary sources** — official docs, source code, specs, first-party APIs — not a secondary write-up of them. Follow every claim back to the source that owns it.
2. Write the findings to a single Markdown file, citing each claim's source.
3. Save it where the repo already keeps such notes; match the existing convention, and if there is none, put it somewhere sensible and say where.
