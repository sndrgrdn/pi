# Pi Harness V2 — Specification

Status: **decision-complete, implementation-ready**. Produced by [Synthesize Pi Harness V2 Specification](../.pi/todos/f5fd2a41.md) on the map [Design Pi Harness V2](../.pi/todos/d349da25.md), synthesizing eleven resolved design tickets plus five synthesis decisions (§9). Production implementation is out of scope for the map; the ordered build plan lives in the follow-up ticket *Produce Pi Harness V2 Implementation Checklist*.

Baseline: pi `@earendil-works/pi-coding-agent` on the `v2` branch of `~/.pi/agent`. Preserved assets: `SYSTEM.md` (two edits, §7.1), `APPEND_SYSTEM.md`, `settings.json`, the Skill Corpus, `pi-mcp-adapter@2.10.0`, MCP configuration. `AGENTS.md` untouched. Amp is evidence, not a blueprint; all Amp-derived contracts were verified against binary/bundle archaeology recorded in the source tickets.

---

## 1. Principles

- **Minimize model-facing cognitive/schema surface**, not raw tool count.
- **One boundary per concern**: Finder = local reads, Librarian = external research, Oracle = advice, Task = delegated mutation, `mcp` = dynamic integration.
- **Single-shot subagents**: every delegated call is a fresh isolated session; nothing a subagent starts outlives its call.
- **No budgets**: no turn caps, wall-clock timeouts, or token ceilings on any agent (Amp `disableTimeout` parity); context window is the natural bound. Output is bounded only by pi-native truncation.
- **Loud failures, single-shot errors**: no harness retries; the parent owns retries. Miss-paths carry recovery data.
- **Pi-native machinery verbatim** wherever it exists: spawn/shell env, output accumulator + bounds, diff renderer, TUI chrome, skill discovery, compaction.

## 2. Modes and Profiles

### 2.1 Modes

Three fixed named Modes: `low`, `medium`, `high`. Default `medium`. No `custom` state exists anywhere — manual model/reasoning changes are ordinary pi behavior; the border keeps the last explicitly selected named Mode. `profiles.json` cannot define additional Modes; unknown Mode keys are a validation error.

Main routes:

| Mode | Model | Reasoning |
|---|---|---|
| `low` | `openai-codex/gpt-5.6-terra` | low |
| `medium` (default) | `openai-codex/gpt-5.6-sol` | medium |
| `high` | `openai-codex/gpt-5.6-sol` | xhigh |

### 2.2 Profiles

A Profile is an **internal resolved bundle**: model, reasoning, tool surface, and posture prompt block per Mode. Built-in defaults ship with the harness. Tool surfaces are Mode-invariant in practice — the field exists in the resolved bundle but defaults identical across Modes; no shipped configuration varies it.

**Route tables for Mode-dependent agents (Oracle, Task) live in profile resolution, not in the agent registry.** The registry entry stays flat (§3.1); the profile layer hands the subagent runner a resolved `{model, reasoningEffort}` per call.

### 2.3 `profiles.json` (synthesis decision §9.1)

Optional global `~/.pi/agent/profiles.json`; no project-level overrides. Two top-level sections, both partial:

```jsonc
{
  "modes": {                    // Main-agent overrides, three fixed keys only
    "high": { "model": "...", "reasoning": "...", "posture": "..." }
  },
  "agents": {
    "finder":    { "model": "...", "reasoning": "..." },            // flat
    "librarian": { "model": "...", "reasoning": "..." },            // flat
    "oracle":    { "low": {...}, "medium": {...}, "high": {...} },  // per route key
    "task":      { "low": {...}, "medium": {...}, "high": {...} }   // per route key
  }
}
```

- `modes.*` may override model, reasoning, posture. Tools are **not** overridable (Mode-invariant surface).
- `agents.*` may override model and reasoning only. Toolboxes and prompts are **not** overridable.
- Strict validation, precise errors: unknown Mode keys, unknown agent keys, unknown fields, invalid model ids or reasoning levels all fail loudly. No fallback/recovery/transaction machinery — failure behavior relies on pi natively (e.g. `setModel()` handles provider auth failures).

### 2.4 Posture blocks

Small prompt blocks tuning **reasoning depth, initiative, and verification intensity only** — never permissions or workflow rules:

- `low`: shortest sound path, bounded exploration, focused verification; correctness still required.
- `medium`: balanced root-cause investigation, end-to-end work, proportionate verification.
- `high`: broad investigation, edge cases and cross-system effects, comprehensive risk-proportional verification without scope expansion.

**Injection mechanism (uniform, synthesis decision §9.4):** the harness appends the active posture block to the system prompt at session build time — Main gets the block for its active Mode; a Task child gets the block matching its `mode` param.

### 2.5 Persistence & UI

- Selected Mode persists globally for future sessions. Resumed sessions restore their recorded Mode and re-resolve it against current Profile configuration.
- `/mode` command and `ctrl+s` both open a `low`/`medium`/`high` selector.
- Active Mode right-aligned in the editor top border: `╭──── medium ─╮`.
- No per-agent lines in the Mode selector; agent route tables are documented in `/mode` docs.

## 3. Shared subagent runtime

### 3.1 Runner and registry

One shared internal subagent runner built on pi's SDK (`createAgentSession`; pattern per `examples/extensions/subagent/`). `finder`, `oracle`, `librarian`, and `task` are thin bindings: input schema → message mapping → runner(registry entry, resolved route) → envelope wrapper → TUI renderer.

Agent-definition registry entry shape: `{key, model, reasoningEffort, systemPrompt, tools, allowMcp}` — **flat, no route arrays, no maxTurns**. For Mode-dependent agents the profile layer (§2.2) resolves the route before the runner is invoked.

### 3.2 Session contract

- Fresh isolated child session per call: agent system prompt (+ posture where specified), parent's cwd, the mapped input as sole user message. No history fork, no resume.
- Single-shot: the child runs to its final assistant message; that message (wrapped in the agent's envelope) is the tool result.
- Concurrency: **uncapped and fully parallel** for every delegation tool; fan-out is multiple tool calls in one assistant message. No mutex, no scheduler; discipline lives in prompt guidance (`## Delegation`, §7.1).
- Recursion: structurally impossible — no delegation tool's toolbox contains itself; Task has no `task`.
- Abort: parent turn abort cancels in-flight child sessions; no partial envelope is returned (Task additionally returns a cancellation report, §6.5).

### 3.3 Background-process lifetime (synthesis decision §9.3)

- **Per-session id namespace.** Every session — Main or child — owns its own background-process registry (`shell-1`, `shell-2`, …). `shell_command_status` and `shell_command_cancel` resolve ids only within the calling session; a child can never observe or kill Main's processes, and vice versa.
- **Child termination kills all.** When a child session terminates for any reason — final message, abort, hard error — the runner kills all its live background processes via `killProcessTree`. Cascading: parent abort → child session ends → child's processes die.
- Consequence (intended): long-lived processes can only belong to Main's session; "start a dev server via Task" is structurally impossible.

### 3.4 Envelopes

Harness-built (never model-built) XML envelopes stamp the child sessionID for TUI addressability and cross-agent consistency:

`<finder_result title="…" sessionID="…">` · `<oracle_result sessionID="…">` · `<librarian_result sessionID="…">` · `<task_result sessionID="…">` / `<task_error sessionID="…">`

Content is the child's verbatim final message (Finder additionally emits a title line the harness lifts into the attribute). Structured stats can ride in later without schema breakage.

### 3.5 Shared TUI renderer

Amp-style single row per call: spinner + detail while running, completion label on finish, expandable child transcript. Parallel calls stack. Labels per agent in §§5–6. No footer-tab machinery, no child-step streaming.

## 4. Main Agent Tool Surface

Exactly ten tools: `shell_command`, `shell_command_status`, `shell_command_cancel`, `apply_patch`, `skill`, `finder`, `oracle`, `librarian`, `task`, `mcp`.

Omitted harness-wide: Todo, direct read/retrieval tools, direct web tools, media tools, dynamic plugin loading, all thread/session tools, `set_session_name`.

**Shell triplet rule (synthesis decision §9.2):** `shell_command`, `shell_command_status`, and `shell_command_cancel` are indivisible — any toolbox containing one contains all three.

### 4.1 `shell_command`

Schema `{command, workdir?, timeout_ms?}`. `workdir` defaults to session cwd; `timeout_ms` clamp 0–60000, default 10000, floor, non-finite → default — **wait-not-kill** semantics.

- **Lifecycle:** runs foreground; if still running at timeout, returns immediately with output-so-far + opaque harness id (e.g. `shell-3`, never an OS PID) and keeps running in background. Backgrounding = the harness stops awaiting the same detached process; no re-parenting.
- **Output bounds:** pi verbatim — last 2000 lines / 50KB (whichever first), full raw output spilled to a temp file, path in footer. The accumulator (incl. temp file) keeps accumulating through the background phase and is shared with `shell_command_status`.
- **Results:** completed + exit 0 → normal result; nonzero exit → tool error with output. Backgrounded → non-error result with bounded output-so-far, id, one-line poll instruction.
- **Process/shell:** pi spawn machinery verbatim — user's configured shell, `getShellEnv`, `detached: true` process group, tracked PIDs. No `login`/`tty` params, no PTY, no stdin channel.
- **Concurrency:** fully concurrent, no resource keys, no cap on live background processes.
- **Kill paths:** exactly three — user abort during the foreground window (pi kills the process tree), `shell_command_cancel`, and session end (§3.3). Backgrounded processes survive turn aborts.
- **Errors:** nonexistent workdir → immediate tool error; spawn failure → tool error with shell message.
- **UI:** pi bash rendering verbatim (title `$ <command>` + muted workdir suffix, 100ms-throttled streaming, 5-line collapsed preview with expand, truncation warnings, elapsed→Took). On backgrounding the widget finalizes `backgrounded as <id> · still running`, elapsed frozen at the timeout. Later output renders only in `shell_command_status` widgets, never retroactively.

### 4.2 `shell_command_status`

Schema `{id, timeout_ms?}` (same clamp/default; `timeout_ms: 0` = instant snapshot). Pure observation — waits for completion or timeout, streaming new output as progress.

- **Cursor:** incremental since-last-read cursor shared across the backgrounding snapshot, every status read, and the final cancel/completion read — backed by the accumulator temp-file **byte offset**, making it lossless (deliberately fixes Amp's rolling-buffer loss). Each read bounded 2000 lines / 50KB via pi `truncateTail` + footer with temp-file path.
- **Completion:** the read that observes exit delivers remaining output + exit status, exactly once. Exit 0 → normal result `exited 0`; nonzero → tool error carrying output + code (mirrors `shell_command`; deliberate deviation from Amp's field-only signal).
- **Lifetime:** read-once — the completing read deletes the record. Exited-but-unpolled records swept lazily at the start of every status/cancel call after 1h since max(exitedAt, lastPolledAt); no timers. Temp file persists on disk.
- **Unknown/stale id:** tool error — `no tracked background process "shell-N"` + note it may have completed and been read + list of live ids (or "none").
- **Concurrency:** fully concurrent across ids, uncapped. Same-id single-flight: a concurrent second read → immediate tool error ("read already in flight").
- **UI:** pi bash widget chrome, id-prefixed: title `shell-N · $ <original command>`, live streaming during the wait, finalizers `still running` / `exited 0` / `exited <n>` (error-styled) / `cancelled`, elapsed frozen at wait end.

### 4.3 `shell_command_cancel`

Schema `{id}`. Kill = `killProcessTree` verbatim: immediate SIGKILL to the process group (Unix `kill(-pid)` with single-pid fallback; Windows `taskkill /F /T`) — the same primitive as pi's foreground abort; one kill story. Catches `&`-backgrounded descendants (shared pgid); only true setsid daemonizers escape. No TERM grace window (escalation addable later without schema change).

- **Cancel-preempts-poll:** cancel is always accepted, never queued. An in-flight status wait resolves immediately with output-so-far + `cancelled` marker (non-error); the cancel call itself is the completing read — consumes the remainder, reports cancelled, deletes the record.
- Unknown id: same loud error as status.
- **UI:** compact row `cancelled shell-N · $ <command>` + final output collapsed.

### 4.4 `apply_patch`

The only editor in V2. Plain JSON tool, schema `{patch: string}`.

- **Parser:** full Codex envelope grammar (`*** Begin Patch`/`*** End Patch`, `*** Add File:`/`*** Delete File:`/`*** Update File:`, `*** Move to:`, `@@` context chunks with ` `/`-`/`+` lines, `*** End of File`). Lenient: heredoc-wrapper strip, `\r` strip, whitespace-tolerant markers, optional trailing LF. Hard error on unrecognized content inside the envelope and on missing `*** End Patch` — truncation fails loudly.
- **Matching:** Codex 4-pass ladder per chunk (exact → rstrip → trim → unicode-punctuation-normalize), forward scan from previous chunk's end, `@@` context narrows start, `*** End of File` anchors at EOF first, trailing-empty-line retry. **Plus ambiguity detection**: after a match at pass N, keep scanning the remainder at the same pass; a second hit errors with both locations and a suggestion to add `@@` context.
- **Paths:** relative → session cwd; absolute allowed as-is; `*** Move to:` identical; parent dirs auto-created for Add/Move. No root fencing or permission gating.
- **Atomicity:** full preflight — parse, read every target, match every chunk, compute all new contents before any write. Sequential writes with rollback from held prior contents; any write failure restores written files and reports the patch wholly failed (honest caveat if rollback itself fails). Move = write destination then remove source; rollback reverses both. Invariant: patch applied or nothing changed.
- **Result (model-facing):** summary only — `Success. Updated the following files:` + `A <path>` / `M <path>` / `D <path>` (cwd-relative; moves as `M old -> new`). No diffs, no fuzzy-match notices.
- **Errors:** collect-all during preflight so one retry turn fixes everything; envelope parse failure alone is fail-fast. Catalog at Codex precision: `Invalid patch (line N): <why>`; `<file>: failed to find expected lines:\n<old_lines>`; `<file>: ambiguous context, matches at lines X and Y — add @@ context`; `<file>: file not found` / `is a directory`.
- **Concurrency:** single per-session mutex; calls serialize. Sibling Task sessions have their own mutexes (cross-session collision safety is prompt-level guidance).
- **UI:** collapsed header `apply_patch · N files (+x -y)`, one block per file rendering its unified diff with pi's diff renderer. The TUI is the sole audience for diffs.

### 4.5 `skill`

Context-purist V1 extension carried forward. Schema `{name: string}` — no enum, no arguments param.

- **Discovery:** pi-native only — `~/.pi/agent/skills/` (global) + `.pi/skills/` (project wins on collision). No `.claude`/`.agents` compat, no remote URLs, no builtins.
- **Activation authority:** no catalog in the system prompt, no name enum in the schema; the model never self-selects from a standing catalog. Prose activation works via the tool's miss-recovery.
- **Triggers:** `$name` and `/name` inline anywhere in the prompt; matcher regex built from loaded names (longest-first) with V1 path-fragment guards; multiple refs per prompt. Trigger → compressed hidden directive (hidden `display:false` message via `before_agent_start`; `input` transform for steered/queued):

  ```
  <skill_directive>
  The user invoked these skills. Before anything else, call the skill tool once per name below, then follow the returned instructions.
  <skill>name</skill>
  </skill_directive>
  ```

  (Compressed vs V1's four-verb enumeration — verify behavior during V2 testing.)
- **Result:** V1 verbatim — `<skill_content name=…>` with frontmatter-stripped body, `Skill directory:` + relative-path note, `<skill_resources>` listing (cap 20, skip dotfiles/`node_modules`/`__pycache__`, exclude `SKILL.md`, truncation marker).
- **Autocomplete:** V1 verbatim — `$` auto-pops (fuzzy on name, description hint); `/` completes on explicit Tab; `/` at line 0 col 0 defers to the command menu; no `/skill:name` command registration.
- **Compaction:** no prune-protection, no dedupe. Instruct the compaction summarizer to record active skill names so the post-compaction model re-calls the tool. Contingency: if pi's compaction prompt proves non-extendable, fall back to plain V1 behavior and note it.
- **Errors:** unknown name → `Unknown skill "X".` + `<available_skills>` names-only list, fuzzy-ranked via pi-tui `fuzzyFilter`, **untruncated** (the miss-path list is load-bearing for prose activation). Load failure → same with path + message.
- **Availability:** Main + Task only. Task briefs may carry `$name` refs; the directive machinery runs on `task` prompt args exactly as on user prompts.

### 4.6 `mcp`

`pi-mcp-adapter@2.10.0` (upstream `a764c25…`, tag `v2.10.0`) owns the entire MCP behavior contract. The harness admits its single model-facing `mcp` gateway **unchanged** on Main and Task — no wrapper, fork, normalization, or second truncation layer; the absence of a general result-size cap is an accepted dependency risk.

- No dynamically registered MCP direct tools on any surface; the gateway is the sole dynamic discovery/invocation path.
- Adapter-owned and accepted as-is: config discovery/import precedence, metadata cache, lifecycle, transports, dedup/refresh; gateway dispatch precedence (`action` → `tool` → `connect` → `describe` → `search` → `server` → status); OAuth/bearer/manual flows, credential storage, consent, elicitation, sampling, MCP Apps, UI-message draining; schema pass-through, result conversion, error shapes, reconnects, concurrency, timeouts, cancellation limitations.
- Adapter `/mcp`, `/mcp setup`, `/mcp-auth` commands and tool renderers preserved; no parallel harness MCP UI.
- Librarian's pinned Exa tools (§6.4) are static toolbox members — distinct from `allowMcp`-style dynamic exposure. Adapter upgrades are ordinary dependency upgrades; V2 tests the admitted boundary, not adapter internals.

## 5. Delegation tools (Main-facing)

| Tool | Schema | Envelope | TUI |
|---|---|---|---|
| `finder` | `{query}` | `<finder_result title sessionID>` | query + live action tally → title |
| `oracle` | `{task, context?, files?}` | `<oracle_result sessionID>` | `Oracle exploring — <task…>` → `Oracle has spoken` |
| `librarian` | `{query, context?}` | `<librarian_result sessionID>` | `Librarian researching — <query…>` → `Librarian researched` |
| `task` | `{prompt, description, mode?}` | `<task_result sessionID>` / `<task_error sessionID>` | `Subagent (<mode>) working` → `Subagent finished`, detail = description |

Shared error contract: single-shot, no harness retry; provider/model failures surface verbatim as tool errors; internal tool errors stay inside the child session; schema junk (missing required field) fails loud; abort → cancelled, child killed, nothing returned (Task excepted, §6.5).

## 6. Agents

Toolbox matrix (shell triplet per §9.2):

| Agent | Toolbox | allowMcp |
|---|---|---|
| Main | the ten tools of §4 | gateway on surface |
| Finder | `grep`, `glob`, `read` (custom) | false |
| Oracle | shell triplet, `finder`, `librarian` | false |
| Librarian | `checkout`, `grep`, `glob`, `read`, shell triplet, pinned `web_search` + `web_fetch` (Exa) | false |
| Task | shell triplet, `apply_patch`, `skill`, `finder`, `librarian`, `mcp` | true (gateway) |

### 6.1 Main

Prompt = `SYSTEM.md` (edits §7.1) + `APPEND_SYSTEM.md` + project context + active-Mode posture block (§2.4). Routes §2.1. Owns retries, delegation restraint (`## Delegation`), and user-facing summaries of subagent output.

### 6.2 Finder

Read-only **by construction**: toolbox has no mutation, shell, or MCP capability — no permission middleware needed. Scope: anywhere readable, absolute paths allowed; cross-repo local reads (e.g. `~/.cache/checkouts`) in scope; remote repos are Librarian's job.

- **Toolbox:** exactly three custom-built tools `grep`, `glob`, `read` — not pi's `createReadOnlyTools`, no `ls` (glob subsumes it).
- **Route:** `anthropic/claude-haiku-4-5` / minimal, Mode-invariant, no fallback.
- **Behavior:** unbounded turns; empty findings → normal envelope stating nothing matched; abort kills, nothing survives.
- **Prompt** (per writing-great-skills; final wording as resolved in the Finder ticket): scout role — given one query, locate files/symbols/code in minimal turns; search guidance (glob/grep/read division, scope-then-narrow, parallel independent searches, semantic pivoting on literal misses, thoroughness matched to the query: quick = one highest-signal search, default = 2–4 naming variants, thorough = aliases + related directories + neighboring concepts); answer format (title line, then one absolute `path:line` per location with a one-line relevance note and minimal proving quotes, done-when criterion incl. the nothing-matched form).

### 6.3 Oracle

Prompt-enforced read-only senior advisor (Amp parity; construction-enforcement rejected as materially weaker — Oracle's workflows need shell for `git diff`/`log`/`blame` and running tests).

- **Routes** (resolved at invocation from parent's active Mode; prompt + toolbox Mode-invariant): low → Sol/high, medium → Sol/high, high → `anthropic/claude-fable-5`/high. Exactly three routes — no `custom` (§9, stale-note fix).
- **Input:** `{task req, context?, files?: string[]}`. Main passes path strings; the **harness** reads each resolvable path and embeds contents (task + context + per-file fenced contents) in Oracle's input message — expensive model, spend its turns reasoning. Unresolvable paths silently skipped; Oracle recovers via shell. Empty final message → explicit error.
- **Prompt contract** (wording at implementation, contracts fixed): (a) role — senior expert reviewer, independent second opinion on subtle reviews / cross-module debugging / architecture tradeoffs / plan stress-tests / type-API design; advises, never implements; (b) read-only mandate — no create/edit/delete/commit/push/install; shell for inspection and evidence (builds/tests OK); (c) method — start from `git diff` for current-work reviews, `finder` for cheap location, `librarian` for external repos, verify before asserting; (d) output discipline — evidence-cited, confidence/severity-ranked, verified facts vs assumptions, smallest safe fix per finding, honor the caller's requested output shape; plus Amp recoveries: zero-shot framing, final-message-only contract, simplicity-first (YAGNI/KISS, effort sizing, one-alternative cap). No tool catalogs, Mode awareness, or harness mechanics in prompt; harness appends cwd/date.

### 6.4 Librarian

Owns **all external research**: remote repositories and the web. One boundary: Finder = local, Librarian = external.

- **New primitive `checkout` `{repo}`** → absolute cache path. Accepts URL / `git@…` / `owner/repo` / bare cached name; `checkout.sh` semantics — partial clone (`--filter=blob:none`), 300s-throttled refresh, fast-forward when clean, cache `~/.cache/checkouts/<host>/<org>/<repo>`. Bare-name resolution in code: one hit = refresh+return; multiple = loud error listing candidates; none = error asking for `owner/repo`. The `/librarian` skill stays the human/Main-facing entry; skill and tool share the checkout logic — no drift.
- **Toolbox:** `checkout`, Finder's `grep`/`glob`/`read` reused, shell triplet (git archaeology inside checkouts — Amp's `commit_search`/`diff` collapse into git), pinned Exa `web_search` + `web_fetch` as static members (provider swap = registry edit, not contract change).
- **Authority:** prompt-enforced read-only — never modify checkouts or anything else.
- **Route:** Sol / reasoning **off**, Mode-invariant, no fallback route.
- **Citations:** fluent-linking mandate adapted to the cache workflow — every file/dir/repo mention cites the canonical remote URL `https://<host>/<org>/<repo>/blob/<commit-sha>/<path>#L<range>`, sha pinned via `git rev-parse` (no rot); cache paths never surface; web claims link their source page; free-form markdown, language-tagged fences, box-drawing diagrams (no Mermaid).
- **Errors:** context-window exhaustion → explicit "try a more specific query" error (Amp parity); otherwise shared contract (§5). `context` prepended as `Context: …\n\nQuery: …`.

### 6.5 Task Agent

The mutating delegate. Full write authority identical to Main: ungated shell + `apply_patch`.

- **Routing:** `mode?: "low"|"medium"|"high"`, omitted = `low`. The parent's session Mode **never** flows in; escalation is always explicit per call. Routes (Task-owned, in Profiles): low → Sol/low, medium → Sol/high, high → Fable 5/high. The `mode` field description names the three routes. (Overturns the earlier "Task inherits parent route" note.)
- **Prompt (synthesis decision §9.4):** `SYSTEM.md` **verbatim** + `APPEND_SYSTEM.md` + standard project-context injection + the Mode posture block matching the `mode` param + appended **Task posture block**: subagent executing one delegated sub-task; the parent cannot see steps or answer questions; the prompt is the complete brief; verify as instructed; end with a final report (files changed, commands run, verification results). No section stripping, no builder machinery — `## Delegation` stays valid since Task retains `finder`/`librarian`.
- **Isolation:** fresh session, parent's cwd, `prompt` arg as sole user message; no history fork, no resume.
- **Verification is contractual:** the posture block demands verification results in the report; the tool description tells the parent to specify verification steps and to summarize for the user (the result is invisible to the user — Amp parity).
- **Errors & cancellation (Amp parity):** parent abort kills children; a cancelled child returns a mechanical completed-work report built from the tool log (`Task was cancelled.` + `## Completed work` with 20-line diff / 10-line bash-output / 80-char command caps + `## In progress when cancelled`); child hard error (esp. context overflow) → an LLM summarizer pass over the full tool-call log returns accomplishments/files modified/findings. All error payloads in `<task_error sessionID>`. Spawn/validation failures plain and loud.
- Depth = 1 via toolbox (no `task`, no `oracle`); `librarian` is the V2 translation of Amp's web tools; `view_media` has no V2 equivalent.

## 7. Prompt & project-context reconciliation

### 7.1 `SYSTEM.md` — exactly two edits

1. **Tool Policy → File changes block**, reworded tool-agnostically (V1 `edit`/`write` vocabulary removed):

   ```
   File changes:
   - read files before changing them
   - patch existing files with targeted hunks
   - full-file replacement only for new files or complete rewrites
   ```

2. **New `## Delegation` section** — restraint-first; the existing "Trust subagent results" line *moves* here from Tool Policy (no duplication). Tool-name-free and generic over "subagent", valid verbatim in Task's derived prompt:

   ```markdown
   ## Delegation

   - default: do it yourself. delegate only when it beats direct work:
     parallel independent items, a large noisy search worth isolating,
     or a bounded sub-task worth its own context
   - never delegate single-response work: one lookup, one read, a
     question you can answer directly
   - fan out in one message for independent items; serialize dependent ones
   - the child sees none of this conversation: the brief must be complete —
     context, paths, constraints, verification steps
   - summarize results for the user; they cannot see subagent output
   - trust subagent results; do not re-check them just to verify
   ```

All other SYSTEM.md content verified Mode-neutral and surface-independent. The `apply_patch` per-session mutex makes the "disjoint edits" parallelism line harmless as written.

### 7.2 Unchanged files

- **`AGENTS.md`** — untouched; Issue-tracker/Triage sections belong to the mattpocock skill system, reconciled there or not at all in this effort. Domain-docs section has no tool dependency.
- **`APPEND_SYSTEM.md`** — user facts only, no tool references.
- **`settings.json`** — `defaultModel`/`defaultThinkingLevel` are pi-managed live state; `enabledModels` only filters Ctrl+P cycling and does not gate SDK subagent model resolution (Finder's Haiku needs no settings change); `packages: pi-mcp-adapter@2.10.0` already matches.

### 7.3 `CONTEXT.md` glossary

- **Agent Profile**: replace the unresolved-properties line with the resolved definition — a Profile resolves model, reasoning, tools, and posture prompt per fixed Mode (low/medium/high).
- **Delete** four dead V1-subagent terms: Parallel Task Limit, Subagent Concurrency, Output Cap, Subagent Session Directory.
- Keep Subagent, MCP Gateway, Checkout Cache.

## 8. Route summary

| Agent | low | medium | high | Mode source |
|---|---|---|---|---|
| Main | Terra/low | Sol/medium | Sol/xhigh | session Mode |
| Finder | Haiku 4.5/minimal | ← | ← | invariant |
| Oracle | Sol/high | Sol/high | Fable 5/high | parent session Mode |
| Librarian | Sol/off | ← | ← | invariant |
| Task | Sol/low | Sol/high | Fable 5/high | per-call `mode` param (default low) |

Model ids: `openai-codex/gpt-5.6-terra`, `openai-codex/gpt-5.6-sol`, `anthropic/claude-fable-5`, `anthropic/claude-haiku-4-5`.

## 9. Synthesis decisions (this ticket)

1. **`profiles.json` two-section schema** (§2.3): `modes.*` (Main: model/reasoning/posture) + `agents.*` (model/reasoning only; per-route keys for Oracle/Task, flat for Finder/Librarian). Resolves the Modes-ticket ("three fixed Modes only") vs agent-ticket ("override via profiles.json") contradiction; route tables live in profile resolution, keeping the registry flat per the Finder ticket.
2. **Shell triplet indivisible** (§4): `shell_command_cancel` added to Oracle, Librarian, and Task toolboxes — amends those three tickets, which predated the cancel tool and left children with no kill path for wedged backgrounded processes.
3. **Background-process lifetime** (§3.3): per-session id namespaces; child termination for any reason kills all its background processes; nothing a subagent starts outlives its call.
4. **Task prompt mechanics + posture** (§6.5, §2.4): Task prompt = `SYSTEM.md` verbatim + project context + Task posture block, no stripping; the `mode` param selects both the route and the matching Mode posture block — one uniform posture-injection mechanism across Main and Task.
5. **Stale-note fixes**: Oracle has exactly three routes (`custom` dropped map-wide by the Modes decision); tool surfaces are Mode-invariant in practice (the Profile `tools` field defaults identical across Modes).

## 10. Out of scope (map-inherited)

Production implementation; migration or V1 compatibility; V1 retirement; thread/session workflows; treating Amp behavior as automatically correct.
