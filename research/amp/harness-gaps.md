# Amp vs Sander's Pi harness

Date: 2026-07-11

Scope: Pi `0.80.6`, started with `--no-builtin-tools`. Only custom/extension tools matter. Default built-in tool prompt snippets and guidelines are intentionally excluded.

## Executive conclusion

The original gap estimate was too large. Pi core already provides:

- automatic context compaction
- pre/post tool middleware
- model and thinking-level switching
- dynamic active-tool sets
- lifecycle events
- persistent resumable session trees
- steering/follow-up messages
- custom compaction hooks

The custom harness already provides:

- a single deferred MCP gateway rather than eagerly exposing every MCP schema
- isolated subagents with provider-specific model routing
- session search and naming
- skills loaded on demand
- live model/usage metrics
- custom file and shell tools

A wholesale rewrite is not justified for Amp parity. The best target is a **small control-plane refactor** around profiles, policies, subagent budgets, and instrumentation.

## Corrected capability matrix

| Amp mechanism | Current Pi/harness | Gap |
| --- | --- | --- |
| Automatic thread compaction | Pi core already compacts at `contextWindow - reserveTokens`, preserves recent tokens, tracks file operations, and retries overflowed turns. `docs/compaction.md` | None. Tune/evaluate it rather than rebuild it. |
| Tool-call/result middleware | Pi exposes `tool_call` and `tool_result`; calls can be mutated/blocked and results transformed. `docs/extensions.md:743-840` | None at API level. No policy extension currently uses it for permissions. |
| Deferred tool schemas | `pi-mcp-adapter` exposes one `mcp` gateway that discovers/calls server tools lazily. Current sessions do not receive every MCP tool schema. | Already solved for the largest schema source. Custom Pi tools remain eagerly visible, but the set is small. |
| Dynamic mode tools | `pi.getActiveTools()` / `pi.setActiveTools()` work with custom tools even under `--no-builtin-tools`. | Configuration layer missing. |
| Model/effort switching | `pi.setModel()` and `pi.setThinkingLevel()` are available. | Configuration layer and fallback policy missing. |
| Prompt adaptation | `before_agent_start` can chain `systemPrompt`; presets can inject profile instructions. | No current profile/model adapter registry. Likely lower priority than evals. |
| Permissions | `tool_call` can fail closed and request UI confirmation; official `permission-gate.ts` demonstrates it. | No declarative policy currently installed. |
| Thread lifecycle | Pi session trees, compaction, `/tree`, steering and follow-ups already exist. Custom FTS search and naming extend this. | Cross-session search exists; workflow-oriented continuation UX could improve, but no architectural gap. |
| Subagents | `extensions/subagent/` spawns isolated Pi subprocesses, supports parallel execution, model/thinking/tool/extension profiles and usage collection. | Missing budgets, fallback chains, output cap, and safer concurrency defaults. |
| Metrics | Prompt box tracks TTFT/tokens; session breakdown provides historical analytics. | Instrumentation is fragmented; no unified event record or traces. |
| Review specialization | Multiple review skills exist. | Structured machine-readable review mode/checker is optional, not foundational. |
| Sandbox | None in this harness; Pi ships sandbox/container examples. | Real gap only for unattended or untrusted execution. |

## Current architecture

### Main-agent control

- `SYSTEM.md`: engineering policy and interaction style.
- `APPEND_SYSTEM.md`: user context.
- `settings.json`: default model `openai-codex/gpt-5.6-sol`, medium thinking.
- All custom extensions are loaded globally; built-ins are disabled at CLI startup.

### Tool plane

Custom tools:

- `bash.ts`
- `read.ts`
- `edit.ts`
- `write.ts`
- `skill.ts`
- `subagent/index.ts`
- `session-search/`
- `session-name.ts`
- `todos.ts`
- MCP gateway package

The tool surface is already materially smaller than Amp's standard profiles.

### Subagent plane

`extensions/subagent/agents.ts` supports:

- provider-specific model maps
- fixed or inherited thinking levels
- fixed or caller-overridden models
- tool subsets
- extension subsets
- project/user agent discovery

Current agents:

- `explore`: Haiku 4.5 or GPT-5.6 Terra, thinking off, no writes by policy
- `general`: inherits caller model/thinking and all extensions

This is already close to Amp's specialized-subagent design. The missing part is operational contracts.

## Actual high-value gaps

### P0 — Safety and correctness

#### 1. Declarative execution policy

Current safety relies primarily on system-prompt behavior. Pi already has the enforcement hook; add a policy extension over `tool_call`.

Recommended rule model:

```ts
interface PolicyRule {
  tool: string
  action: "allow" | "ask" | "deny"
  context?: "interactive" | "headless" | "subagent"
  command?: RegExp
  path?: string
}
```

Minimum enforced cases:

- destructive shell commands
- `git push`, force operations, amend/reset/clean
- writes outside the workspace
- credential/auth paths
- headless mode defaults to deny for `ask`

Pi source support: `docs/extensions.md` `tool_call`; official example `examples/extensions/permission-gate.ts`.

#### 2. Subagent budgets

Current constants allow 32 batched tasks and 32 concurrent subprocesses. There is no output cap or turn/time/cost budget. This conflicts with `CONTEXT.md`, which defines an Output Cap but the implementation does not enforce one.

Add per-agent frontmatter:

```yaml
maxTurns: 8
maxDurationMs: 300000
maxOutputChars: 50000
maxCostUsd: 1.00
concurrencyClass: cheap
```

Recommended defaults:

- parallel task limit: 8
- subagent concurrency: 4
- explore max turns: 3–5
- general max turns: 12–20
- retained output: 50 KiB per batch, with explicit truncation marker and artifact path

Pi has no native `maxTurns`; enforce by observing child JSON turn events and terminating gracefully, then force-killing after a short deadline.

#### 3. Fix cwd consistency in `edit.ts`

`bash.ts`, `read.ts`, and `write.ts` instantiate their core tool against `ctx.cwd` per execution. `edit.ts` captures `process.cwd()` once at extension load. If the session cwd changes, edits can resolve against the wrong directory.

Fix before broader refactoring.

### P1 — Control plane

#### 4. Add profile presets, not a new agent runtime

Pi's official `examples/extensions/preset.ts` already implements most of an Amp-like Dial. Adapt it into a small `profile` extension.

A profile should resolve:

```ts
interface Profile {
  model: ModelRoute[]
  thinking: ThinkingLevel
  tools: string[]
  instructions?: string
  advisor?: AdvisorPolicy
  budgets?: AgentBudgets
}
```

Suggested initial profiles:

| Profile | Primary | Thinking | Difference |
| --- | --- | --- | --- |
| `low` | GPT-5.6 Terra | low/off | precise tasks; smaller subagent budgets |
| `medium` | GPT-5.6 Sol | medium | current default behavior |
| `high` | GPT-5.6 Sol | xhigh | stronger verification and Oracle recommendation |
| `ultra` | Claude Fable 5 | high | decomposition and cross-model advice |

Keep tools nearly identical. Your current tool set is already compact; artificial tool differences would add complexity without much context savings.

Profile UX:

- `--profile low|medium|high|ultra`
- `/profile`
- one shortcut to cycle
- prompt-box displays profile
- persist selection with `pi.appendEntry()` and restore on `session_start`
- expert model override remains available

#### 5. Model fallback resolver

Your agent model map selects by caller provider but does not fall back when unavailable. Add ordered routes:

```yaml
models:
  - openai-codex/gpt-5.6-terra
  - anthropic/claude-haiku-4-5
```

Resolution should check `ctx.modelRegistry`, authentication availability through `pi.setModel()` return values, and record the resolved route. Avoid silent behavior changes: display fallback in the prompt-box/status.

### P2 — Maintainability and observability

#### 6. Consolidate instrumentation

Three components independently inspect usage/state:

- `extensions/context.ts`
- `extensions/prompt-box/metrics.ts`
- `extensions/session-breakdown.ts`

Create a small shared instrumentation module/event store, then keep each UI as a consumer. Do not build OTEL first; establish a stable internal event schema first.

Suggested events:

```ts
agent.started
provider.requested
provider.completed
tool.started
tool.completed
compaction.completed
subagent.completed
```

Capture timestamps, model/profile, tokens, cost, duration, status, and tool name. Never store raw prompts/tool payloads by default.

#### 7. Stop persisting raw provider payloads by default

`extensions/context.ts:959-971` clones, serializes, and writes complete provider requests under `.cache/context-payloads/` on every request. The cache currently contains hundreds of files. These payloads may include system prompts, user messages, code, and tool results.

Change to one of:

- opt-in debug flag
- ring buffer with strict retention
- metadata-only default
- explicit redaction and size limits

This is more important than adding OTEL.

#### 8. Align extension dependencies with runtime

Runtime Pi is `0.80.6`; `extensions/package.json` pins Pi packages at `^0.79.1`. The semver range may resolve newer compatible versions, but verify the lockfile. Keep extension types aligned with the actual runtime to catch API drift.

#### 9. Split only the unstable seams

`context.ts` and `subagent/index.ts` are large, but size alone does not justify a rewrite. Extract narrowly:

- context capture/storage
- token/context model
- context TUI
- subagent process runner
- subagent event parser
- subagent renderer
- subagent policy/budgets

Preserve current behavior with characterization tests before moving code.

## What not to build

### Do not rebuild compaction

Pi already has stronger native support than the earlier comparison recognized:

- threshold and overflow triggers
- recent-token retention
- iterative summaries
- file-operation tracking
- branch summaries
- custom compaction hooks

Instead, add an eval that verifies requirements, modified files, test status, and unresolved blockers survive compaction.

### Do not build generic lifecycle middleware

Pi already exposes the needed lifecycle and tool hooks. Build policy and instrumentation extensions on those hooks.

### Do not build general deferred-tool infrastructure yet

The MCP gateway already solves the expensive case. Your custom tool count is small. Reconsider only if profiles accumulate dozens of uncommon tools.

### Do not copy Amp's tool sets literally

Amp's product integrations drive much of its tool profile. Your harness should optimize for your workflows, not match Amp's catalog.

### Do not fork full prompts per model without eval evidence

Start with a shared `SYSTEM.md`, profile instructions, and thin model adapters. Fork only behaviors proven problematic by tests.

## Recommended target architecture

```text
Pi core
  ├── native sessions / trees / compaction
  ├── native extension lifecycle
  └── native model + tool activation APIs

Harness control plane
  ├── profiles.ts          model, thinking, tools, advisor, budgets
  ├── model-router.ts      ordered routes + visible fallback
  ├── policy.ts            allow / ask / deny over tool_call
  └── instrumentation.ts   metadata event stream

Execution plane
  ├── cwd-aware core tools
  ├── MCP gateway
  ├── skills
  ├── subagent runtime     budgets + bounded output
  └── session/todo tools

UI consumers
  ├── prompt box
  ├── context inspector
  └── session breakdown
```

## Refactor sequence

1. Add characterization tests for `edit`, subagent command construction, child-event parsing, cancellation, and output handling.
2. Fix `edit.ts` cwd resolution.
3. Add subagent budgets and reduce concurrency defaults.
4. Add declarative `tool_call` policy with headless fail-closed behavior.
5. Add profile extension by adapting Pi's `preset.ts`; initially preserve the existing medium behavior.
6. Add model fallback resolver and visible resolved-profile state.
7. Make raw provider-payload persistence opt-in and bounded.
8. Consolidate instrumentation behind a shared metadata event schema.
9. Split large files only where tests establish stable seams.
10. Add harness evals: tool routing, permissions, subagent budgets, compaction survival, profile resolution, and fallback behavior.

## Major-refactor decision

**Recommend:** substantial incremental refactor, not rewrite.

The foundational architecture is sound because Pi core already supplies Amp's most important primitives. The major work belongs in a new control plane and stronger boundaries around the existing subagent/context extensions. Replacing the harness would discard working capabilities without addressing the actual gaps.

## Evidence

Harness:

- `settings.json`
- `SYSTEM.md`
- `extensions/context.ts:959-974`
- `extensions/edit.ts`
- `extensions/subagent/agents.ts`
- `extensions/subagent/index.ts`
- `extensions/prompt-box/metrics.ts`
- `agents/explore.md`
- `agents/general.md`

Pi `0.80.6`:

- `docs/extensions.md`
- `docs/compaction.md`
- `docs/sessions.md`
- `docs/sdk.md`
- `dist/core/extensions/types.d.ts`
- `dist/core/extensions/runner.js`
- `dist/core/agent-session.js`
- `examples/extensions/preset.ts`
- `examples/extensions/permission-gate.ts`
- `examples/extensions/custom-compaction.ts`
