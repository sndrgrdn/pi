# AmpCode Harness Design Evidence for Pi Harness V2

Date: 2026-07-12

## Question

Which concrete AmpCode harness choices, contracts, and observed behaviors provide useful evidence for Pi Harness V2, and which product-specific choices should not transfer?

## Sources and confidence

Primary local evidence:

- [`research/amp/README.md`](README.md): artifact-backed inspection of local Amp build `0.0.1783772103-g850382` (2026-07-11).
- [`research/amp/harness-gaps.md`](harness-gaps.md): prior Amp/Pi comparison, corrected against Pi core.
- Amp executable symbols, routing registries, tool registries, and public documentation cited by the primary research.

Pi comparison claims were rechecked against installed Pi `0.80.6`:

- `docs/extensions.md`: runtime tool activation, model/thinking changes, prompt hooks, tool-call/result middleware, and permission-gate/preset examples.
- `docs/compaction.md`: threshold and overflow compaction, recent-context retention, cumulative file-operation tracking, and custom compaction hooks.
- `dist/core/extensions/types.d.ts` and `dist/core/agent-session.js`: `setActiveTools`, `setModel`, and `setThinkingLevel` contracts and implementation.

Confidence labels below distinguish directly observed architecture from recommendations inferred for V2. Amp prompt bodies and invocation policies are not locally observable.

## Direct reverse engineering

This section records what was independently recovered from the executable, before abstraction into V2 implications.

### Method and provenance

Inspected artifact:

```text
~/.amp/bin/amp
Mach-O 64-bit executable arm64
70,942,562 bytes
SHA-256 9aec1c7c587edfb23c2972d19c63bc830d2e1d5b9fd8da2191ab23bac3604f05
version 0.0.1783772103-g850382
release 2026-07-11T12:15:03.000Z
```

The Bun payload contains a 4,403,773-byte readable minified JavaScript region. The analysis located registries and contracts by byte marker, extracted balanced object/array literals, and evaluated only data-shaped literals with stubbed model/feature-flag references. Findings below were also checked against the original binary bytes, not only the prior prose research.

Key binary anchors:

| Binary offset | Recovered structure |
| ---: | --- |
| `65,331,658` | start of readable `main.js` region |
| `65,341,170` | expanded (`t0`) main-agent tool array |
| `65,341,487` | expanded deferred integration array (`b9`) |
| `65,342,088` | standard (`a0`) main-agent tool array |
| `65,342,411` | mode/profile registry (`Y$`) |
| `65,431,933` | review-checker turn bound (`fKR=20`) |
| `69,525,020` | specialist tool arrays (`pKR`, `OKR`, `qKR`, etc.) |
| `69,525,532` | specialist registry (`HKR`) |

Reproduction checks used byte searches against the current executable plus fresh parsing of the extracted readable region. The generic extractor recovered build metadata, 43 model entries across seven providers, and 14 directly parseable built-in tool specs. Its older mode-registry heuristic did not recognize the current `Y$`/`HKR` names, so those two literals and their adjacent arrays were extracted directly by balanced delimiters rather than silently trusting an empty parser result.

### Recovered profile contract

The `Y$` registry demonstrates this concrete record shape:

```text
profile = {
  key,
  displayName,
  description,
  model: model | ordered conditional routes,
  systemPrompt,
  includeTools,
  deferredTools?,
  reasoningEffort,
  reasoningEffortControl?,
  visible,
  visibleInApp,
  visibleWhen?,
  serverOnly?,
  uiHints?
}
```

The route entries themselves can override `systemPrompt` and `reasoningEffort` and carry `when` predicates such as feature enabled, feature disabled, or active agent mode. This is stronger evidence than “Amp has modes”: routing, prompt adaptation, effort, capability surface, availability, and presentation are data in one resolution structure.

Concrete observations from the recovered records:

- `medium`: conditional GPT-5.6 Sol/GPT-5.4 route; route-specific `deep`/`deep-gpt5.4` prompt; standard tools; deferred Gmail tools; medium effort.
- `high`: the same model family and tool arrays as `medium`; `high`/`high-gpt5.4` prompt; xhigh effort.
- `low`: GLM-5.2 first when permitted, then Terra or GPT-5.4; default medium effort but route-level low overrides for the latter two.
- `ultra`: Claude Fable 5; expanded tools; deferred Gmail; visibility gated by retention and inference policy.
- hidden records (`deep`, `smart`, `rush`, `large`) and server-only `agg-man` coexist with the public Dial. Visibility is independent of routability.

### Recovered capability surfaces

The adjacent arrays reveal deliberate surface composition rather than one global toolbox:

```text
standard (a0):
  shell_command, shell_command_status, apply_patch,
  web_search, read_web_page, Task, skill, load_plugin,
  read_thread, find_thread, list_agent_modes, create_thread,
  librarian, oracle, finder, view_media, painter,
  archive_current_thread, automation/Slack, aggregator messaging

expanded (t0):
  finder, shell_command, shell_command_status,
  create_file, edit_file, web/thread/research/delegation tools,
  read_mcp_resource, automation/Slack, aggregator messaging

deferred (F9/b9): gmail_read, gmail_write

review (BB):
  shell_command, run_check, submit_review,
  list_agent_modes, create_thread
```

Notable negative evidence: the standard surface uses `apply_patch`, while expanded uses `create_file` and `edit_file`; review exposes neither general editing nor broad research. This indicates authority/workflow shaping, not simply cumulative “higher mode gets every tool.”

### Recovered specialist contract

The `HKR` registry has this shape:

```text
specialist = {
  key,
  displayName,
  model: model | ordered conditional routes,
  reasoningEffort,
  systemPrompt,
  includeTools,
  allowMcp,
  maxTurns?
}
```

Recovered role boundaries:

| Specialist | Tools/authority recovered from adjacent arrays | MCP | Bound |
| --- | --- | ---: | ---: |
| Finder | `Grep`, `glob`, `Read` | no | — |
| Oracle | shell, web, Librarian, Finder, pages, thread retrieval | no | — |
| Advisor | thread retrieval, Librarian, Finder | no | — |
| Thread Reader | two thread-specific internal tools | no | — |
| Librarian | GitHub read/search/diff/list plus web read/search | no | — |
| Task Subagent | Finder, shell/status, patching, web, skill, media | yes | — |
| Code-review checker | read/grep/glob and shell/status | no | 20 turns |

`allowMcp` is an explicit authority bit independent of `includeTools`; only Task Subagent enables it in this registry. The High-mode Oracle route additionally predicates Claude Fable 5 on both active `high` mode and policy flags, proving that a delegated route can depend on the parent profile.

### Recovered tool-execution contracts

The built-in tool specs expose scheduler-facing metadata beyond JSON schema:

```text
executionProfile.resourceKeys(args) -> [{ key: absolutePath, mode: "read" | "write" }]
executionProfile.serial -> boolean
```

Observed uses:

- `Read` and path-scoped `Grep` declare read resources.
- `create_file` and `edit_file` declare write resources.
- shell start/status set `serial: false` and no resource keys.
- file creation/edit schemas require absolute paths; edit descriptions require reading first.
- `shell_command_status` accepts the PID returned by `shell_command` and waits for incremental output, making background execution an explicit two-stage lifecycle.

This is concrete evidence for concurrency/authority metadata at the execution boundary. It does **not** prove Amp's scheduler semantics beyond what these declarations encode.

### Abstraction extracted from the implementation

| Recovered implementation mechanism | Product-neutral harness information |
| --- | --- |
| Conditional route arrays | Resolution is policy/context-sensitive and ordered; fallback is part of the profile contract. |
| Route-level prompt/effort overrides | Provider substitution may require behavior adaptation, not merely another model ID. |
| Separate visibility fields | Internal availability, user discoverability, and app presentation are different concerns. |
| `includeTools` plus `deferredTools` | Initial model-visible capability and discoverable late capability should be modeled separately. |
| Specialist `allowMcp` | External capability authority should be explicit and independent of ordinary tool lists. |
| Specialist `maxTurns` | Execution budgets belong in machine-enforced agent configuration. |
| Resource keys with read/write modes | Tool scheduling and conflict control can derive from declared resource access. |
| Shell/status split | Start, observe, cancel, and completion can have different lifecycles even within one conceptual capability. |
| Narrow review surface | Workflow-specific output contracts can justify a separate profile without granting mutation authority. |

These abstractions are evidence inputs. They remain subject to the Empty Tool Baseline and capability-admission evaluation; none automatically becomes a V2 interface.

## Transferable evidence

### 1. A profile is a resolved capability bundle, not a model alias

**Observed:** Amp's Dial can jointly select model, provider-specific effort, prompt key, tool profile, advisor route, and policy-aware fallback. `medium` and `high` can share model and tools while differing in prompt and effort. Provider effort labels are not comparable capability units.

**Evidence for V2:** Agent Profiles should resolve an explicit bundle:

```text
profile -> model route + effort + prompt additions/adapter + active tools + delegation policy + budgets
```

The public profile name should describe expected operating behavior, while the resolved route remains visible for diagnosis. Preserve an expert model override.

**Pi feasibility (verified):** Pi extensions can change model, thinking level, active tools, and per-turn system prompt. This needs a harness control plane, not a replacement runtime.

**Confidence:** high for Amp's bundle behavior; high for Pi feasibility; medium that a Dial-like public scale is the best V2 UX.

### 2. Model-family adaptation can be thinner than prompt forks

**Observed:** Amp selects dedicated GPT-5.4 prompt keys for some Dial positions. Full current prompt bodies were not recoverable, so their differences are unknown.

**Evidence for V2:** Keep `SYSTEM.md` as the shared baseline. Permit small profile instructions and model-family adapters only where evaluation demonstrates a behavioral mismatch. Do not infer that Amp maintains wholly separate prompts.

**Pi feasibility (verified):** `before_agent_start` handlers can chain system-prompt changes.

**Confidence:** high that Amp selects model-specific prompt variants; low on their contents; medium on thin adapters as the appropriate V2 response.

### 3. Role boundaries are expressed through context and authority

**Observed:** Amp separates Finder, Librarian, Oracle/Advisor, Thread Reader, Task Subagent, and review checker roles. Their toolboxes differ materially: retrieval agents are narrow/read-oriented, advisors do not implement, and task agents can execute. A review checker has a 20-turn bound.

**Evidence for V2:** Delegation contracts should name role, authority, context source, output shape, verification duty, and budgets. Distinct authority or lifecycle boundaries justify distinct interfaces or agent definitions; superficial task categories do not.

Likely durable boundaries:

- local read-only exploration;
- external research;
- advisory reasoning without mutation;
- bounded delegated execution;
- conversation/session archaeology;
- evidence-driven review.

**Confidence:** high for observed role/tool separation; medium that every listed boundary deserves a dedicated V2 agent rather than parameters on fewer primitives.

### 4. Selective model diversity is a capability, not a mandatory ceremony

**Observed:** Amp can cross-pair a GPT primary agent with a Claude Oracle. The artifact proves availability and routing, but not a reliable automatic invocation rule.

**Evidence for V2:** Delegation should permit deliberate cross-model advice/review. Admission should be tied to uncertainty, architectural breadth, safety, repeated failed verification, or explicit review—not an unconditional second pass.

**Confidence:** high for cross-family routing; low for invocation behavior; medium for the proposed admission policy.

### 5. Tool schemas can be deferred where they are expensive or uncommon

**Observed:** Amp defer-loads some integrations. Its common profiles still expose a substantial stable tool set; low is not aggressively deprived of research or delegation.

**Evidence for V2:** Optimize total model-facing schema and choice burden, not raw tool count. Keep common cohesive primitives directly visible; defer large integration catalogs and rare capabilities.

**Pi comparison (verified):** Runtime active-tool changes are native. The existing `pi-mcp-adapter` already defers the largest external schema catalog behind one discovery/call gateway.

**Confidence:** high for Amp's deferred integrations and Pi's dynamic surface; high that wholesale lazy loading is not justified by this evidence.

### 6. Fallback preserves intent, not identical provider settings

**Observed:** Amp routes the same Dial position across models with different effort values and sometimes different prompt keys. Availability is policy-aware.

**Evidence for V2:** Model routes should be ordered and explicit. Each route may define its own effort and adapter. Resolution and fallback must be observable; silent fallback makes evaluations and incident diagnosis unreliable.

**Confidence:** high.

### 7. Bounded delegation is part of the contract

**Observed:** At least one Amp checker has an explicit maximum-turn budget; specialized agents use intentionally different effort and authority.

**Evidence for V2:** Subagent contracts should include maximum turns/duration/output, parallel-task acceptance, concurrency, cancellation, and retained-result behavior. Budgets belong to the harness contract rather than prompt-only instructions.

**Confidence:** high that Amp supplies bounded specialization; medium for the complete proposed V2 budget set.

### 8. Separate capabilities when lifecycle differs

**Observed:** Amp separates shell start from long-running command status, shell execution from patching, and primary execution from advisory/research agents.

**Evidence for V2:** The Minimal High-Quality Primitive criterion should preserve separations where lifecycle, mutation authority, cancellation, or result timing differ. A lower tool count alone is not evidence for merging them.

**Confidence:** high for observed separation; high as a design criterion.

## Product-specific choices that should not transfer

| Amp choice | Why it is not V2 evidence by itself |
| --- | --- |
| Exact `low`/`medium`/`high`/`ultra` names and routes | Product positioning, commercial model access, retention policy, and current provider economics determine them. |
| Exact tool catalog | Gmail, Slack, painter, automation, thread, and other integrations reflect Amp's product surface, not required Pi Harness jobs. |
| Ultra-only file tools | No observed evidence shows this partition improves Pi workflows; V2 should derive authority from profiles/jobs and evaluation. |
| Specific model assignments | Build- and policy-dependent routing will age quickly. Preserve route semantics, not model names. |
| Amp prompt keys or historical extracted prompts | Current prompt bodies are not verified. Copying old prompts would confuse historical artifacts with current contracts. |
| Oracle invocation policy | The executable exposes availability, not when or why the main agent calls it. |
| One tool per named specialist | Amp's product taxonomy does not prove Pi needs the same model-visible interfaces. Similar roles may share one delegation primitive with explicit contracts. |
| Separate status tool as a literal requirement | It proves lifecycle separation matters, not that Pi must adopt Amp's exact API shape. |
| Review mode implementation | Structured review is useful evidence, but its exact models, tools, and checker topology are product choices. |
| Amp parity as a target | Pi already natively supplies compaction, lifecycle hooks, dynamic tools, model/thinking switching, sessions, and prompt hooks. Rebuilding these would ignore the actual substrate. |

## Non-findings and evidence limits

- No current Amp main-agent prompt body was verified.
- No reliable automatic Oracle/advisor trigger was recovered.
- Tool presence does not prove invocation frequency, quality, or necessity.
- Routing configuration does not establish causal performance improvements.
- The local artifact is one build under one observed policy context; Amp can change server-side behavior.
- This research contains no cross-model evaluation results. It supplies hypotheses and constraints for later evaluation, not admissions by itself.

## Decision implications for Pi Harness V2

Treat the following as design hypotheses supported strongly enough to carry into specification and evaluation:

1. Define Agent Profiles as observable resolved bundles, not model aliases.
2. Keep the shared prompt baseline; add thin profile/model adapters only with evaluation evidence.
3. Design delegation around explicit role, authority, context, output, verification, and budget contracts.
4. Support selective cross-model advice/review without making it mandatory.
5. Defer expensive/rare schemas, especially integrations; do not hide common primitives merely to minimize count.
6. Model fallback as ordered, route-specific, and visible.
7. Enforce delegation budgets and bounded retained output in code.
8. Preserve separate primitives where lifecycle or authority differs.

Treat all exact Amp names, models, prompts, tool inventories, and product workflows as non-transferable until independently justified by Pi Harness jobs and empirical evaluation.

## Bottom line

AmpCode provides useful evidence for a small, explicit harness control plane and role-bounded delegation. It does **not** justify copying Amp's profiles, tool catalog, prompts, or routing table. Pi `0.80.6` already supplies the native mechanisms needed for profiles, dynamic tool surfaces, middleware, prompt adaptation, and compaction; V2's work is selecting and enforcing contracts over that substrate.
