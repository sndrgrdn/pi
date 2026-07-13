# Pi Harness V2 — Implementation Checklist

Status: **approved build plan**. Produced by [Produce Pi Harness V2 Implementation Checklist](../.pi/todos/6b99a86c.md) on the map [Design Pi Harness V2](../.pi/todos/d349da25.md). The contract of record is [`docs/pi-harness-v2-spec.md`](./pi-harness-v2-spec.md) — this checklist orders the work and states acceptance; it does not restate contracts. Section references (§) point at the spec.

Baseline: `v2` branch of `~/.pi/agent`. All new code lives in one extension package, `extensions/harness/`, inside the existing pnpm workspace (vitest + typescript already configured in `extensions/package.json`).

## How to use

- Phases land **in order**; each phase is sized to roughly one agent session.
- **Uniform gate, every phase:** `tsc --noEmit` and `vitest run` green across the workspace, plus the phase's smoke items executed live in pi.
- Two test tiers (agreed): unit tests (vitest, no model calls) for pure logic; manual smoke items for model-dependent behavior. No live-model automated tests, no CI.

---

## Phase 0 — Baseline cleanup + scaffold

Dispositions for existing V1 material:

- [ ] Delete superseded model-facing extensions: `extensions/bash.ts`, `edit.ts`, `read.ts`, `write.ts`, `todos.ts`, `subagent/`, `session-name.ts`
- [ ] Delete `agents/explore.md` (and confirm `agents/general.md`, `extensions/session-search/` deletions already in the working tree get committed)
- [ ] Move carry-forwards into the harness: `extensions/skill.ts` and `extensions/disable-invocation.ts` relocate to `extensions/harness/skill/` (ported in Phase 3 — Phase 0 only stages the move)
- [ ] Leave untouched (UI/QoL, not model-facing): `prompt-box/`, `context.ts`, `undo.ts`, `whimsical.ts`, `session-breakdown.ts`, `cc-patch.ts`
- [ ] Scaffold `extensions/harness/` with `index.ts` entry and module skeleton:

  ```
  extensions/harness/
    index.ts            # extension entry: wires everything
    modes.ts            # Mode state, /mode, alt+s, mode events, persistence
    profiles.ts         # built-in Profiles + profiles.json load/validate/merge
    registry.ts         # flat agent-definition registry (§3.1)
    runner.ts           # shared subagent runner (createAgentSession)
    envelopes.ts        # §3.4
    shell/              # shell_command, _status, _cancel + process registry
    patch/              # apply_patch parser/matcher/applier
    skill/              # carried-forward skill extension
    tools/              # finder, oracle, librarian, task bindings + checkout
    agents/prompts/     # finder.md, oracle.md, librarian.md, task-posture.md, postures
    ui/                 # shared subagent row renderer
  ```

- [ ] Commit as the cleanup commit; V1 tool extensions no longer load

**Gate:** pi starts clean on `v2`; no deleted extension errors; `tsc`/`vitest` green (empty harness compiles).

## Phase 1 — Shell triplet (§4.1–§4.3, §3.3)

Foundation: every later agent toolbox embeds these three tools.

- [ ] `shell/registry.ts`: per-session background-process registry — opaque `shell-N` ids, accumulator temp-file byte-offset cursors, read-once completion, 1h lazy sweep, same-id single-flight, `killProcessTree` kill path (§3.3, §4.2)
- [ ] `shell/command.ts`: `shell_command` — pi spawn machinery + output bounds verbatim; wait-not-kill timeout (clamp 0–60s, default 10s); backgrounding return contract (§4.1)
- [ ] `shell/status.ts`: `shell_command_status` — pure-observation poll, lossless cursor reads, exit-exactly-once, unknown/stale-id loud error with live-id list (§4.2)
- [x] `shell/cancel.ts`: `shell_command_cancel` — cancel-preempts-poll, cancel is the completing read (§4.3)
- [x] TUI: pi bash widget verbatim for `shell_command` incl. `backgrounded as <id>` finalizer; id-prefixed chrome for status/cancel widgets (§4.1–§4.3 UI clauses)
- [ ] Register the triplet on the main session (builtin `bash` stays enabled until Phase 10)
- [ ] Unit tests: registry lifecycle (background → poll → complete → read-once delete), cursor losslessness across snapshot/status/cancel reads, sweep timing, single-flight rejection, timeout clamp table, unknown-id error shape

**Smoke:** run a >10s command; watch it background at 10s; poll twice (second poll sees only new output); cancel a live process; nonzero exit surfaces as tool error on the completing read.

## Phase 2 — `apply_patch` (§4.4)

- [ ] `patch/parser.ts`: full Codex envelope grammar, lenient parse, loud truncation failure
- [ ] `patch/matcher.ts`: 4-pass ladder + ambiguity detection (second-hit error with both locations)
- [ ] `patch/applier.ts`: full preflight → sequential writes → rollback; collect-all preflight errors; per-session mutex
- [ ] Model-facing result: summary-only `A/M/D` lines; error catalog at Codex precision
- [ ] TUI: collapsed header + per-file pi diff renderer
- [ ] Register on the main session (builtin `edit`/`write` stay until Phase 10)
- [ ] Unit tests (largest suite — port Codex fixture cases): grammar accept/reject table, each matcher pass, ambiguity, EOF anchor, move + parent-dir creation, atomic rollback on forced mid-write failure, collect-all error aggregation, cwd-relative/absolute path handling

**Smoke:** multi-file patch applies atomically in TUI with diffs; deliberately ambiguous patch errors with both line numbers; malformed envelope fails loudly.

## Phase 2a — read tool (§4.3a, amendment §11)

Added by the 2026-07-12 amendment. Harness-built `read` — the harness runs builtin-less; port the V1 read extension from git history (deleted in Phase 0 commit `de70a3a`).

- [ ] Port V1 `read.ts` into the harness: `{path, offset?, limit?}`, text bounds 2000 lines / 50KB + continuation hint, image formats (jpg/png/gif/webp/bmp) as attachments, loud missing-file errors
- [ ] Register on Main (Task gets it in Phase 9)
- [ ] Unit tests: offset/limit windows, truncation bounds, image mime detection, missing-file error shape

**Smoke:** read a text file with offset/limit; read a png → image attachment in the TUI.

## Phase 3 — Skill port (§4.5)

- [x] Port `skill.ts` into `harness/skill/` — V1 behavior verbatim: tool schema `{name}`, result format (`<skill_content>` + resources cap 20), autocomplete, `$name`/`/name` triggers with path-fragment guards
- [x] Fold `disable-invocation.ts` logic in: strip pi's skill catalog from the system prompt (no catalog anywhere)
- [x] Compressed `<skill_directive>` hidden message (verify behavior vs V1's four-verb enumeration during smoke)
- [x] Miss-path: fuzzy-ranked **untruncated** `<available_skills>` list via `fuzzyFilter`
- [x] Compaction: **contingency hit** — pi's compaction prompt is non-extendable (`SessionBeforeCompactResult` only allows `cancel` or full `compaction` replacement; no `customInstructions` passthrough, verified in `pi-coding-agent@0.79.1` `core/extensions/types.d.ts` + `core/agent-session.js`). Fell back to plain V1 behavior: no active-skill recording; recovery is re-invoking the trigger or prose activation via the miss-path list.
- [x] Unit tests: trigger matcher (longest-first, multiple refs, path-fragment guards), directive construction, miss-path ranking + untruncated output, resources listing rules

**Smoke:** `$skillname` in a prompt → tool call → instructions followed; unknown name recovers via list; system prompt contains no skill catalog; compaction round-trip re-loads the active skill.

## Phase 4 — Modes + Profiles (§2)

- [ ] `profiles.ts`: built-in Profile defaults (route tables §8); `~/.pi/agent/profiles.json` two-section partial-override schema, strict validation with precise errors (§2.3)
- [ ] Posture blocks (low/medium/high + Task posture text) as prompt assets; uniform injection — append active posture to system prompt at session build (§2.4, §9.4)
- [ ] `modes.ts`: `low | medium | high | null` Mode state; `/mode` command + `alt+s` selector; Mode published on the event bus for prompt-box to render in the editor top border; global persistence; resume restores recorded Mode state (§2.5)
- [ ] Main route switching only on explicit Mode selection (Terra/low, Sol/medium, Sol/xhigh); startup/new/reload/resume preserve pi's model/provider/reasoning; manual model/reasoning changes persist `null`
- [ ] Unit tests: profiles.json validation matrix (unknown Mode key, unknown agent key, unknown field, bad model id, bad reasoning level → each a precise error), merge semantics (partial override over defaults), route resolution per agent per Mode, posture selection

**Smoke:** switch Modes via both entry points → route + named-only border update; manually change model/reasoning → `null` state + existing model/reasoning border; restart/new/reload/resume preserve pi's route and restore the appropriate global/session Mode state; invalid profiles.json fails loudly at startup; valid override observed live.

## Phase 5 — Shared subagent runtime (§3)

- [ ] `registry.ts`: flat agent-definition entries `{key, model, reasoningEffort, systemPrompt, tools, allowMcp}`; profile layer resolves routes for Mode-dependent agents before runner invocation (§3.1)
- [ ] `runner.ts` on `createAgentSession` (pattern: pi `examples/extensions/subagent/`): fresh isolated child session, parent cwd, mapped input as sole user message, single-shot final-message contract (§3.2)
- [ ] Child termination kills all its background processes (`killProcessTree`), cascading on parent abort (§3.3); per-session shell-id namespaces already isolated via Phase 1 registry
- [ ] `envelopes.ts`: harness-built XML envelopes stamping child sessionID (§3.4)
- [ ] `ui/`: shared Amp-style row renderer — spinner + detail, completion label, expandable child transcript, parallel stacking (§3.5)
- [ ] Uncapped concurrency; no mutex/scheduler; abort cancels in-flight children with no partial envelope
- [ ] Unit tests: registry shape, envelope construction, kill-all-on-termination (fake processes), input mapping

**Smoke:** none yet — proven via Finder in Phase 6.

## Phase 6 — Finder (§6.2, §5)

- [ ] Custom `grep`/`glob`/`read` tools (not `createReadOnlyTools`, no `ls`) — read-only by construction
- [ ] Finder prompt asset per §6.2 (scout role, search guidance, thoroughness tiers, answer format)
- [ ] `tools/finder.ts` binding: `{query}` → runner → `<finder_result title sessionID>` (harness lifts title line); Haiku 4.5/minimal Mode-invariant
- [ ] TUI: query + live action tally → title on completion
- [ ] Unit tests: grep/glob/read behavior + bounds, title extraction, empty-findings envelope

**Smoke:** `finder` round-trips live; parallel fan-out (two finders in one message) stacks in TUI; abort kills the child; child shell ids invisible from Main (via a Task later — here assert registry isolation in tests).

## Phase 7 — Librarian (§6.4)

- [ ] `checkout` primitive `{repo}` → cache path; `checkout.sh` semantics (partial clone, 300s throttle, ff-when-clean, `~/.cache/checkouts/<host>/<org>/<repo>`); bare-name resolution (one/multiple/none) in code; `/librarian` skill and tool share the logic — no drift
- [ ] Toolbox assembly: `checkout` + Finder's grep/glob/read + shell triplet + pinned Exa `web_search`/`web_fetch` as static members
- [ ] Librarian prompt asset: external-research role, prompt-enforced read-only, commit-sha canonical-URL citation mandate, cache paths never surface (§6.4)
- [ ] Binding: `{query, context?}` (context prepended) → `<librarian_result sessionID>`; Sol/off Mode-invariant; context-window exhaustion → "try a more specific query" error
- [ ] TUI: `Librarian researching — <query…>` → `Librarian researched`
- [ ] Unit tests: bare-name resolution matrix, cache pathing, throttle/ff logic (fs-mocked), context prepend, error mapping

**Smoke:** live query against a remote repo → citations are `https://…/blob/<sha>/…` links, no cache paths; web question cites source pages.

## Phase 8 — Oracle (§6.3)

- [ ] Binding: `{task, context?, files?}`; harness reads resolvable `files` and embeds fenced contents in the input message, silently skipping unreadable paths; empty final message → explicit error
- [ ] Oracle prompt asset per §6.3 contract points (role, read-only mandate, method, output discipline, Amp recoveries); harness appends cwd/date
- [ ] Toolbox: shell triplet + `finder` + `librarian`; routes resolved from parent's active Mode via Profiles (low/medium → Sol/high, high → Fable 5/high)
- [ ] Envelope `<oracle_result sessionID>`; TUI `Oracle exploring — <task…>` → `Oracle has spoken`
- [ ] Unit tests: file-embedding (resolvable/unresolvable mix), route resolution per parent Mode, empty-message error

**Smoke:** live review of a real diff in each Mode; observed model matches route table; Oracle runs `git diff` but never writes.

## Phase 9 — Task (§6.5)

- [ ] Binding: `{prompt, description, mode?}` (omitted = `low`); Task-owned routes via Profiles; parent Mode never flows in; `mode` field description names the three routes
- [ ] Prompt assembly: `SYSTEM.md` verbatim + `APPEND_SYSTEM.md` + project context + Mode posture block for the `mode` param + Task posture block (§9.4)
- [ ] Toolbox: shell triplet + harness `read` (§4.3a) + `apply_patch` + `skill` + `finder` + `librarian` + `mcp` gateway (`allowMcp: true`); no `task`, no `oracle`; per-child apply_patch mutex
- [ ] `$name` skill triggers run on `prompt` args exactly as on user prompts
- [ ] Cancellation report: mechanical completed-work report from tool log (caps per §6.5) in `<task_error sessionID>`; child hard error → LLM summarizer pass over the tool-call log
- [ ] Envelope `<task_result sessionID>`; TUI `Subagent (<mode>) working` → `Subagent finished`, detail = description
- [ ] Unit tests: prompt assembly (verbatim SYSTEM.md + correct posture pair), mode→route mapping, cancellation-report builder from a synthetic tool log (diff/output/command caps), error-payload shapes

**Smoke:** delegated edit lands and Task report includes verification results; abort mid-Task → cancellation report received, child's background process dead; skill trigger inside a Task brief fires.

## Phase 10 — Surface lock (§4, §4.6)

- [ ] Disable any remaining pi builtins on Main via `pi.setActiveTools()` — harness tools only; no builtin read/edit/write/bash/ls visible (harness `read` per §4.3a is the only read)
- [ ] Admit `pi-mcp-adapter@2.10.0` gateway unchanged on Main (and Task per Phase 9); no wrapper, no dynamic direct MCP tools; adapter commands/renderers preserved (§4.6)
- [ ] Assert exactly eleven tools on Main: `shell_command`, `shell_command_status`, `shell_command_cancel`, `read`, `apply_patch`, `skill`, `finder`, `oracle`, `librarian`, `task`, `mcp`
- [ ] Assert child surfaces match the §6 toolbox matrix (incl. shell-triplet indivisibility §9.2)
- [ ] Unit tests: toolbox matrix assertions per agent (registry-level)

**Smoke:** fresh session lists exactly the eleven tools; `read` returns an image attachment for a png; `/mcp` status works through the adapter; a disabled builtin-tool name in a prompt produces no phantom call.

## Phase 11 — Prompt & context reconciliation (§7)

- [ ] `SYSTEM.md`: exactly two edits — tool-agnostic File-changes block; new `## Delegation` section with the trust line moved in (text verbatim from §7.1)
- [ ] `CONTEXT.md`: resolve Agent Profile definition; delete Parallel Task Limit, Subagent Concurrency, Output Cap, Subagent Session Directory; keep Subagent, MCP Gateway, Checkout Cache (§7.3)
- [ ] Confirm untouched: `AGENTS.md`, `APPEND_SYSTEM.md`, `settings.json` (§7.2)
- [ ] Diff-review both edited files against spec §7 word-for-word

**Gate:** diff matches spec exactly; pi session builds with the edited prompt; `## Delegation` reads valid inside a Task child prompt.

## Phase 12 — End-to-end acceptance

Run the full smoke script (all phase smoke items) plus the binary acceptance criteria:

1. [ ] Main exposes exactly the eleven §4 tools (incl. harness `read`); no pi builtins visible
2. [ ] Route table §8 verified live per Mode per agent (model + reasoning observed in session)
3. [ ] Shell: background → lossless poll → cancel; child sessions cannot see Main's ids
4. [ ] apply_patch: multi-file patch atomic; ambiguity error; rollback on forced failure
5. [ ] Skill: `$name` trigger works; miss-path list returned; no catalog in system prompt
6. [ ] Each delegation tool round-trips with correct envelope + TUI row; parallel fan-out works
7. [ ] Task cancellation report + `<task_error>` path observed
8. [ ] profiles.json: valid override applies; invalid file fails loudly at startup
9. [ ] SYSTEM.md/CONTEXT.md edits match spec §7 exactly
10. [ ] Backgrounded child process dies with its child session

**Gate:** all ten criteria pass; `tsc`/`vitest` green; V2 declared built.
