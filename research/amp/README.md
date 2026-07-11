# Amp Dial and agent harness research

Source inspected: local `~/.amp/bin/amp` build `0.0.1783772103-g850382`, released 2026-07-11.

This is an educational, artifact-backed analysis for improving a Pi harness. It excludes credentials, authentication state, and user threads. Amp is proprietary; names and routing can change between builds.

## Architecture

Amp's public abstraction is accurate:

> agent = model + system prompt + tools

The Dial is a stable task-difficulty interface over a changing routing table. It does not merely change reasoning effort. A Dial position can change:

- primary model
- reasoning effort
- named system prompt
- tool set
- Oracle model
- availability/fallback behavior

The default mode is `medium`. Legacy client values normalize as follows:

| Legacy value | Dial value |
| --- | --- |
| `rush` | `low` |
| `smart` | `medium` |
| `deep` | `medium` |
| `large` | `medium` |

## Current Dial configuration

Routing depends on workspace/provider policy. `ACCEPT_ABUSE_DATA_RETENTION` gates newer hosted models; provider-block flags control availability.

| Dial | Preferred model | Fallback | Prompt key | Effort | Tool profile |
| --- | --- | --- | --- | --- | --- |
| `low` | `AMP_GLM_5_2` | GPT-5.6 Terra when retention is accepted, otherwise GPT-5.4 | `low` | `medium`; Terra/GPT-5.4 override to `low` | compact agent profile |
| `medium` | GPT-5.6 Sol when retention is accepted | GPT-5.4 | `deep` or `deep-gpt5.4` | `medium` | standard agent profile |
| `high` | GPT-5.6 Sol when retention is accepted | GPT-5.4 | `high` or `high-gpt5.4` | `xhigh` | standard agent profile |
| `ultra` | Claude Fable 5 | unavailable when retention/Fable policy disallows it | `ultra` | `high` | expanded agent profile |

Important observations:

1. `medium` and `high` may use the same model and tools. Their material differences are prompt and reasoning effort.
2. GPT-5.4 gets dedicated prompt variants for `medium` and `high`. Amp does model-family prompt adaptation rather than assuming one universal prompt.
3. `low` is not always the lowest reasoning setting. Its preferred GLM route uses `medium`; stronger fallback models use `low` effort.
4. `ultra` uses Claude with `high`, while `high` uses GPT with `xhigh`. Dial labels represent expected capability, not comparable provider effort values.
5. Availability is policy-aware. The same Dial position may route differently between workspaces.

## Tools by Dial position

### Shared effective tools: low, medium, and high

- `finder`
- `shell_command`
- `shell_command_status`
- `apply_patch`
- `web_search`
- `read_web_page`
- `read_thread`
- `find_thread`
- `list_agent_modes`
- `create_thread`
- `skill`
- `load_plugin`
- `oracle`
- `librarian`
- `Task`
- `view_media`
- `painter`
- `archive_current_thread`
- `manage_automation`
- `slack_write`
- `slack_read`
- `send_message_to_agg`

`medium` and `high` additionally defer-load Gmail read/write integrations when available.

### Ultra additions

- `create_file`
- `edit_file`
- `read_mcp_resource`

Ultra otherwise retains the standard tools.

### Tool-design implications

- Amp prefers a small set of high-level primitives over exposing every filesystem operation.
- Shell execution and patch application are separate capabilities.
- Long-running commands have a separate status tool.
- Retrieval, external research, advice, media understanding, and delegated execution are distinct tools/subagents.
- Integrations can be deferred, reducing the initial schema/context footprint.
- Tool availability is mode-specific, but low is not aggressively crippled; it can still delegate and research.

## Subagents

| Agent | Preferred routing | Fallback | Effort | Tools / role |
| --- | --- | --- | --- | --- |
| Finder | Gemini 3 Flash Preview | — | `minimal` | `Grep`, `glob`, `Read`; narrow code retrieval |
| Oracle | Claude Fable 5 for High when allowed; otherwise GPT-5.6 Sol | GPT-5.4 | `high` | shell, web, Librarian, Finder, pages, thread retrieval; advisory reasoning |
| Advisor | Claude Fable 5 when allowed; otherwise GPT-5.5 | GPT-5.4 | `high` | thread retrieval, Librarian, Finder |
| Thread Reader | GLM-5.2 | GPT-5.6 Sol, then GPT-5.4 | `high` | thread-oriented retrieval/synthesis |
| Librarian | GPT-5.6 Sol | GPT-5.4 | `none` | GitHub and web research |
| Task Subagent | GPT-5.6 Sol | GPT-5.4 | `low` | Finder, shell/status, patching, web, skill, media |
| Code-review checker | Claude Haiku 4.5 | — | `medium` | `Read`, `Grep`, `glob`, shell/status; maximum 20 turns |

### Oracle behavior

Oracle is an advisory/research subagent, not the code-review implementation. In `high`, Amp deliberately cross-pairs the GPT writer with Claude Fable as Oracle when policy permits. Other modes generally use GPT-5.6 Sol or GPT-5.4.

This provides model diversity without making every task a mandatory two-pass workflow. The local artifact exposes Oracle availability and routing, but not a reliable rule proving when the primary agent invokes it.

### Review mode

Review is a separate direct agent mode:

- preferred model: GPT-5.5 when retention is accepted
- fallback: GPT-5.4
- prompt key: `review`
- tools: `shell_command`, `run_check`, `submit_review`, `list_agent_modes`, `create_thread`

The local `codereview-check` subagent is a bounded checker used within that workflow.

## Prompt findings

The executable exposes prompt identifiers and model-specific selection:

- `low`
- `deep`
- `deep-gpt5.4`
- `high`
- `high-gpt5.4`
- `ultra`
- `review`

The current readable client bundle does **not** contain the corresponding full main-agent prompt text. Searches for known prompt openings and prompt-builder functions found only unrelated classifier instructions. Likely explanations:

1. prompt bodies are resolved server-side by key; or
2. some bodies are compiled into Bun bytecode rather than readable embedded JavaScript.

Therefore, full prompt text from older public extraction repositories should not be presented as the current Dial prompts. The locally verified finding is stronger architecturally: Amp versions prompts by task tier and, where needed, model family.

## Lessons for Pi

### 1. Make capability the public control

Expose a short, stable task-complexity scale instead of model names. Internally resolve a profile:

```text
profile = {
  model,
  effort,
  prompt,
  tools,
  advisor,
  budgets
}
```

Keep an explicit model override for experts and debugging.

### 2. Adapt prompts per model family

Maintain shared policy fragments, then use thin model adapters:

```text
base engineering policy
+ task-tier behavior
+ model-family adapter
+ active tool guidance
+ workspace instructions
```

Do not fork entire prompts unless evals show that it is necessary. Amp's dedicated GPT-5.4 keys suggest targeted adaptations are worthwhile.

### 3. Separate roles by context and toolbox

Useful Pi roles based on Amp's decomposition:

- `explore`: cheap, fast, read-only local retrieval
- `librarian`: external repositories/docs, no local writes
- `oracle`: high-reasoning advice, read/research only
- `general`: delegated execution with an isolated context
- `review`: evidence-driven review with structured findings
- `thread-reader`: conversation archaeology and chronology

Role-specific tools matter as much as role-specific prompts.

### 4. Use model diversity selectively

Pair the strongest writer with a different model family for difficult review/advice. Avoid unconditional second passes. Trigger diversity for:

- cross-cutting architecture
- security or data-loss risk
- uncertain root cause
- repeated failed verification
- explicit review requests

### 5. Defer expensive tool schemas

Load integrations and uncommon tools only when selected. This saves prompt tokens and reduces accidental tool choice. Pi skills and MCP discovery already provide the right primitives; mode profiles can decide what is initially visible.

### 6. Give delegation explicit contracts

Each subagent call should specify:

- task and boundaries
- read/write permission
- expected result shape
- verification requirement
- context budget
- completion/turn budget

Amp's bounded review checker demonstrates the value of role-specific turn limits.

### 7. Treat fallback as a first-class configuration

A mode should preserve intent across providers, not preserve an exact effort value. Configure model-specific effort and prompt adapters per route. Log the resolved profile so behavior is explainable.

## Suggested Pi mode profiles

| Pi profile | Primary behavior | Advisor | Tool policy |
| --- | --- | --- | --- |
| `low` | precise execution; minimal exploration | only on request/failure | core read/edit/shell; cheap explore |
| `medium` | normal end-to-end engineering | available | full standard tools and subagents |
| `high` | deeper hypothesis testing and verification | cross-model Oracle encouraged | standard tools; stronger budgets |
| `ultra` | architecture/orchestration; parallel decomposition | cross-model Oracle/review | full tools, MCP, multiple subagents |

Recommended difference between `medium` and `high`: not verbosity. Increase hypothesis breadth, verification rigor, advisor use, and context/turn budgets.

## Artifact evidence

Recovered from the Mach-O Bun payload:

- executable size observed during extraction: 70,942,562 bytes
- `__BUN` payload file offset: `62,734,336`
- readable `main.js`: binary offsets `65,331,658..69,735,430`
- mode registry symbol `Y$`: binary offset `65,342,411`
- legacy routing symbol `U7`: binary offset `65,347,562`
- subagent tool registry: binary offset `69,525,020`
- subagent registry symbol `HKR`: binary offset `69,525,532`
- code-review checker maximum turns: `fKR=20`, binary offset `65,431,933`

Temporary extraction artifacts were written under `/var/folders/ll/1bgc36c17hvcxqmyvb87wwz40000gp/T/amp-current/`.

## Public references

- https://ampcode.com/models
- https://ampcode.com/news/the-dial
- https://ampcode.com/news/custom-agents
- https://ampcode.com/manual/plugin-api
- https://github.com/ben-vargas/ai-amp-cli — older artifact-backed extraction; useful historically, not authoritative for this build
