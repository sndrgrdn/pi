# Pi 0.80.6 native capability substrate

Research for **Inventory Native Pi Capability Substrate** under **Specify Pi Harness V2**.

Inspected installation: `@earendil-works/pi-coding-agent` 0.80.6 at `/Users/sander/.local/share/mise/installs/node/24.14.1/lib/node_modules/@earendil-works/pi-coding-agent`.

This inventory distinguishes native mechanism from Pi's current defaults. A native mechanism is available implementation substrate; it is not automatically a justified Pi Harness V2 model-visible capability.

## Executive answer

Pi 0.80.6 can host Pi Harness V2 from an Empty Tool Baseline without replacing core. `createAgentSession()` can start with no built-in tools, accept explicit custom tools, load extensions and resources, construct or override the system prompt, persist tree-shaped sessions, and expose lifecycle interception around model requests, context, tools, compaction, and session transitions.

The main constraints are:

1. Tool admission has two layers: a hard allowed set and a mutable active set. Extension tool registration does not guarantee reachability.
2. Pi's built-in Skill Delivery is coupled to the `read` tool: skill metadata is omitted from the system prompt when `read` is not selected.
3. Session replacement creates a new `AgentSession` and invalidates the old extension runner and captured extension contexts.
4. Extensions are powerful in-process code, not a security boundary. Project trust gates project resources, but trusted extensions can alter requests, context, tools, sessions, and process execution.
5. Session persistence is append-only JSONL organized as a tree; compaction changes reconstructed model context but preserves history.
6. Core defaults—four coding tools, built-in prompt prose, automatic skills, compaction thresholds, queue modes—are policy choices, not mandatory substrate.

## Capability inventory

### 1. Empty baseline and tool composition

Evidence: `dist/core/sdk.js` (`createAgentSession`, `createCodingTools`, `createReadOnlyTools`), `dist/core/tools/index.js`, `docs/sdk.md`.

Native built-ins are `read`, `bash`, `edit`, `write`, `grep`, `find`, and `ls`. The normal default active set is only `read`, `bash`, `edit`, and `write`. Factories bind each tool to a working directory; SDK consumers can instead pass custom `ToolDefinition[]`.

`createAgentSession()` supports:

- `noTools: "all"`: no built-in or extension/custom model-visible tools;
- `noTools: "builtin"`: suppress built-ins while retaining extension/custom tools;
- `tools`: explicit tool-name allowlist;
- `excludeTools`: subtract names;
- `customTools`: inject model-facing tool definitions.

The allowed set and active set are distinct. Extensions may call `setActiveTools()`, but only within the allowed universe assembled by the SDK. When `tools` is explicitly supplied, extension/custom names must also be admitted there.

Built-in implementation details available for reuse include cwd binding, image-aware reads, streamed subprocess output, exact-text edits with unified patch details, recursive writes, and per-file mutation serialization. These contracts remain optional evidence; V2 need not expose their current names or schemas.

**V2 implication:** use `noTools: "all"` or an explicit allowlist as the construction boundary. Registering a tool must never be treated as capability admission.

### 2. SDK composition boundary

Evidence: `dist/core/sdk.js` (`createAgentSession`), `dist/core/agent-session.js`, `dist/core/agent-session-runtime.js`, `docs/sdk.md`.

`createAgentSession(options)` is the principal composition root. It accepts or creates:

- `SessionManager`;
- `SettingsManager`;
- `AuthStorage` and `ModelRegistry`;
- `ResourceLoader`;
- model and thinking level;
- built-in selections and custom tools;
- scoped model candidates and a session-start event.

It creates the core agent, restores session context, wires provider transport and retry/settings behavior, then returns `{ session, extensionsResult, modelFallbackMessage? }`. Model resolution falls through session state, settings, then an available-model fallback. Thinking level is similarly restored and clamped to the selected model.

Provider interception is natively wired through extension hooks for headers, raw request payloads, responses, and transformed context. The SDK therefore supports a maintained harness layer without forking provider code.

`AgentSessionRuntime` replaces whole sessions for new-session, switch, fork, and import flows. Replacement emits lifecycle events, tears down the old runtime, creates a new one, and invalidates the old extension runner.

**V2 implication:** centralize session construction in one Harness factory. Never retain an `AgentSession` or extension context across replacement; reacquire and resubscribe.

### 3. Extensions as privileged harness modules

Evidence: `dist/core/extensions/loader.js`, `dist/core/extensions/runner.js`, `dist/core/extensions/types.js`, `docs/extensions.md`.

Extensions are JavaScript/TypeScript factories loaded from project, user, configured, package, or inline sources. They may register:

- model-visible tools;
- slash commands, shortcuts, and flags;
- message/session renderers;
- providers;
- lifecycle handlers.

They may also send messages, append custom session entries, name sessions, label entries, inspect or alter active tools, change model/thinking level, execute subprocesses, publish events, compact, abort, shut down, and initiate session operations through command contexts.

Important interception points include:

- `before_agent_start`, `agent_start/end/settled`, turn and message events;
- `input` and `context` transformation;
- `tool_call` blocking and `tool_result` transformation;
- provider request/header/response hooks;
- resource discovery;
- project trust resolution;
- before/after switch, fork, tree navigation, and compaction.

Handlers run in extension/load order. Handler errors are isolated and reported rather than terminating the chain. Tool name collisions are first-registration-wins; diagnostics detect conflicts but do not establish an authority policy. Command collisions receive suffixed invocation names. TypeScript loading uses in-process transpilation.

**Constraints:**

- extensions share process authority with Pi and can execute code;
- ordering can affect tool ownership and transformations;
- captured contexts become stale after session replacement;
- hooks differ in semantics: for example, provider headers mutate in place while other hooks return transformations;
- print/RPC modes may have no interactive UI.

**V2 implication:** extensions are suitable for trusted implementation modules, not for capability sandboxing. Harness ownership, ordering, collision policy, and model-visible admission need explicit contracts.

### 4. Sessions, branching, and compaction

Evidence: `dist/core/session-manager.js`, `dist/core/compaction/compaction.js`, `docs/sessions.md`, `docs/session-format.md`.

Sessions are append-only version-3 JSONL. The header identifies the session, cwd, timestamp, and optional parent session. Subsequent entries have IDs and parent IDs, forming a tree. Native entries cover messages, model/thinking changes, compaction, branch summaries, session metadata, extension custom data/messages, and labels.

`SessionManager` supports persistent, in-memory, open, recent, forked, and listed sessions. Branching moves the active leaf; it does not delete history. Context reconstruction walks the selected branch and applies compaction boundaries. A file is not created until the first assistant message, so a newly created session may exist only in memory.

Compaction is enabled by default when estimated context exceeds `contextWindow - reserveTokens`; defaults are 16,384 reserve tokens and 20,000 recent tokens. Pi chooses a safe cut point, summarizes older context with the active model, retains file-operation metadata, and appends a compaction entry. Later summaries can incrementally incorporate the prior summary. Extensions can cancel or observe compaction.

Migrations rewrite older formats; ordinary operation appends.

**V2 implication:** native sessions can support provenance, resume, branches, workflow metadata, and instrumentation through custom entries. Custom state should respect branch semantics. Compaction quality depends on the active model and is not a deterministic archival transform.

### 5. Prompt and project-context assembly

Evidence: `dist/core/system-prompt.js` (`buildSystemPrompt`), `dist/core/resource-loader.js` (`DefaultResourceLoader`, `loadProjectContextFiles`), `docs/usage.md`, `docs/sdk.md`.

Pi can use either its built-in coding prompt or a custom prompt. Assembly order is:

1. custom `SYSTEM.md` content or built-in default;
2. `APPEND_SYSTEM.md` content;
3. project-context files in `<project_context>` blocks;
4. available-skill metadata when eligible;
5. current date and cwd.

`DefaultResourceLoader` discovers extensions, skills, prompt templates, themes, context files, and system-prompt files. It supports category disable flags, additional paths, inline extension factories, and override functions for loaded resource sets and prompt text.

Context discovery loads global `AGENTS.md` first, then walks ancestors toward cwd; compatible `CLAUDE.md` names are also accepted. Project-local prompt and context resources require project trust. `SYSTEM.md` replaces Pi's built-in prompt; `APPEND_SYSTEM.md` appends.

**V2 implication:** preserving the existing prompt/context assets is directly supported. Profile-specific prompt composition can be implemented through a custom `ResourceLoader`, overrides, or `before_agent_start`; the architecture should choose one owner to avoid hidden precedence.

### 6. Skills and prompt templates

Evidence: `dist/core/skills.js` (`loadSkills`, `formatSkillsForPrompt`), `dist/core/prompt-templates.js`, `docs/skills.md`, `docs/prompt-templates.md`.

Native skill discovery spans user, project, `.agents`, configured, package, and command-line paths. A skill is a `SKILL.md` with validated frontmatter and a maximum-length name/description. First discovery wins on duplicate names. `disable-model-invocation` removes a skill from model discovery while preserving direct use.

Current built-in Skill Delivery formats eligible skill metadata as XML in the system prompt, including absolute `SKILL.md` paths. Crucially, `buildSystemPrompt()` only includes this section when `read` is among selected tools. Skill slash commands are separately controlled by `enableSkillCommands` (default true).

Prompt templates are non-recursively discovered Markdown files with positional/default argument expansion and slash-command invocation. They are user input expansion, not model-visible tools.

**V2 implication:** the Skill Corpus is independently reusable, but native model-driven delivery assumes filesystem `read`. A V2 without that exact tool needs a custom skill discovery/loading primitive or a deliberate prompt-injection mechanism. Skill commands do not solve autonomous model discovery.

### 7. Settings and trust

Evidence: `dist/core/settings-manager.js`, `dist/config.js`, `docs/settings.md`.

Settings merge global `~/.pi/agent/settings.json` with trusted project `.pi/settings.json`; nested objects deep-merge while arrays/scalars are replaced by the project value. In-memory settings and overlays are available for SDK hosts. Writes are queued, locked, and asynchronous; callers requiring durability must `await flush()`.

Settings cover default model/provider/thinking, steering and follow-up queues, transport, compaction, retry, idle timeout, skill commands, resource/package paths, image handling, project trust, session directory, and enabled models. Legacy forms are migrated on load.

Project trust gates project settings, extensions, skills, prompts, themes, context files, and prompt files. User-global extensions can participate in pre-trust resolution. Trust permits loading privileged code; it is not granular capability authorization.

**V2 implication:** retain existing settings as baseline data, then add Harness-specific profile/capability configuration through a clearly owned settings namespace or an independent config layer. Do not infer model tool authority from project trust alone.

## Native mechanism versus current policy

| Area | Native mechanism | Current policy/default |
| --- | --- | --- |
| Tools | Empty, allowlisted, excluded, custom, and extension tools are supported | `read`, `bash`, `edit`, `write` start active |
| Prompt | Full custom prompt and append/context composition | Built-in coding-assistant prose when no `SYSTEM.md` |
| Skills | Discoverable corpus and direct commands | Metadata injected only with `read`; commands enabled |
| Sessions | Persistent/in-memory tree, branches, custom entries | Persistent cwd-scoped JSONL |
| Compaction | Hookable summary entries and context reconstruction | Enabled; 16,384 reserve / 20,000 recent |
| Extensions | Broad in-process lifecycle and registration API | Auto-discovery from configured trusted locations |
| Settings | Layered/in-memory managers and overrides | Global plus trusted-project deep merge |
| Models | Registry, fallback, scoped candidates, thinking clamp | Session/settings-selected initial model |

## Architecture guidance for later tickets

1. Build V2 through one SDK composition root with an explicit empty or named allowlist.
2. Treat model-visible tool registration and capability admission as separate operations.
3. Use extensions only as trusted adapters; define deterministic ownership and ordering.
4. Redesign Skill Delivery explicitly because native delivery is coupled to built-in `read`.
5. Put durable workflow/instrumentation facts in typed custom session entries, accounting for branches.
6. Make session replacement a first-class runtime transition, not an internal detail.
7. Select one prompt-composition authority and document the interaction with preserved `SYSTEM.md`, `APPEND_SYSTEM.md`, and `AGENTS.md`.
8. Preserve Pi defaults only when evaluation justifies them; none of the current default tool set, skill injection, or compaction thresholds is forced by core.

## Source index

Installed official documentation:

- `README.md`
- `docs/sdk.md`
- `docs/extensions.md`
- `docs/sessions.md`
- `docs/session-format.md`
- `docs/skills.md`
- `docs/prompt-templates.md`
- `docs/settings.md`
- `docs/usage.md`

Installed implementation:

- `dist/core/sdk.js`
- `dist/core/agent-session.js`
- `dist/core/agent-session-runtime.js`
- `dist/core/tools/index.js`
- `dist/core/extensions/loader.js`
- `dist/core/extensions/runner.js`
- `dist/core/extensions/types.js`
- `dist/core/session-manager.js`
- `dist/core/compaction/compaction.js`
- `dist/core/system-prompt.js`
- `dist/core/resource-loader.js`
- `dist/core/skills.js`
- `dist/core/prompt-templates.js`
- `dist/core/settings-manager.js`
- `dist/config.js`
