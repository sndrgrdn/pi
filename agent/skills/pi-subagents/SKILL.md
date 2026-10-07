---
name: pi-subagents
description: "Delegate authorized work to configured Pi subagents: bounded tasks, sequential or parallel workflows, independent review, and background coordination."
---

# Pi Subagents

Work directly unless the current request or applicable user/project instructions authorize delegation. Complexity, risk, task size, and available specialists do not independently authorize it. The parent owns scope, decisions, final verification, and publication authority.

## Launch procedure

1. **Establish authority.** Identify the delegated result and the child's edit/action boundary. Choose delegation only where evidence, specialization, independent review, parallelism, or isolation earns its overhead.
2. **Enable and inspect.** If `subagent` is unavailable, call `subagents_enable({})` and follow its activation response. Call `subagent({ action: "list", capabilities: true })` in the target cwd and confirm that the selected agent is executable. For external CLI agents, require `runner.available === true`; this is only command discoverability, not authentication or launch compatibility. Launch preflight remains authoritative.
3. **Choose the shape.** Use one direct `{ agent, task, async: true }` call for a bounded child. For multi-step or parallel delegation, use exactly one top-level async workflow call and launch children only inside it. Read the installed guides before using unfamiliar fields or advanced controls.
4. **Supply the brief.** Give each child its objective; repository, cwd, and ref; edit/action authority; relevant files and constraints; acceptance criteria; validation; expected result; and stop/ask conditions. Resolve blocking scope or data decisions before launch. For a model override, first call `{ action: "models" }` and copy an exact provider/id. A model suffix selects thinking; the dispatch `thinking` field does not.
5. **Launch and consume.** Prefer background execution. Continue independent work, then return control when only children remain active. Consume completed results at dependency barriers, inspect actual changes, and verify affected behavior in the parent before accepting completion.

## Workflow essentials

Write one fenced `js workflow` block and call `subagent({ workflow: true, async: true })` in the same reply, or use `workflow: "./path/to/script.js"` for a saved script.

- Sequential steps: `await runs.run(key, { label, agent, task })` before using the result.
- Independent children: `await runs.all([{ key, label, agent, task }, ...])`. It returns an ordered array, not a key map.
- Give workflow children stable keys and short verb + behavior labels. Direct calls have no key or label fields.
- Use top-level `await`, ordinary JavaScript branching, and an explicit `return`. Nested async helpers are rejected. Observe every stored launch promise with `await`, `Promise.race`, or `Promise.all`.
- Omit child `async` to await final results. Explicit child `async: true` returns a launch receipt, not completion evidence.
- Bind durable reports through the child's `output` field, preferably a runtime-managed relative path. Return actual `outputReference`, `outputPathMapping`, or `artifactPaths`. Use `output: false` when no separate report is needed.

## Ownership and coordination

Keep one writer per cwd/worktree and leave unrelated changes untouched. Use isolated worktrees for concurrent writers. Split work only where independence or ownership makes it useful. Use fresh context and explicit read-only boundaries for independent reviews; evaluate findings before applying approved changes.

Background children receive normal extension discovery; foreground children do not load ambient extensions. Use `async: false` only when blocking is necessary and the child's required tools can load there.

Ordinary async children notify the parent on completion. Return control rather than sleeping, polling, or using `bg_wait` merely to wait. Reserve `bg_wait` for work without native notifications when its result is required in the current turn.

Children ask for decisions through injected `contact_supervisor`; parents reply through `subagent_supervisor`. Check `status` before intervening, use `steer` for live guidance, and consult the retained-run rules before `resume`. Nested delegation requires explicit parent authorization and child capability.

## Failure boundary

Treat workflow, launch, prompt, extension, and tool setup failures as infrastructure blockers. Stop and report the exact failure, run/status, and repo/cwd/worktree/branch/ref. Before retrying or asking the owner, verify a clean worktree or capture the partial diff. Use a clear same-protocol retry; changing execution mode requires owner approval. Preserve the child's model/tool contract and keep secrets out of prompts, arguments, and reports.

## Installed references

The installed schema, runtime restrictions, and current configuration control supported calls; do not infer them from bundled agent names or this skill.

- Exact fields, output routing, retained runs, and controls: `subagent({ action: "guide", topic: "tool-reference" })`.
- Scripted sequences, fanout, lanes, and worktree recipes: `topic: "workflows"`.
- Configuration defaults and disabled features: `topic: "configuration"`.
