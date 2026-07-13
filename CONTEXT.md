# Pi Agent Extensions

This context describes the language for local Pi agent extensions, especially delegated agent execution.

## Language

**Pi Harness**:
The maintained layer over Pi core comprising profiles, prompts, custom tools, the subagent runtime, skills, session workflows, and instrumentation. Pi core, model providers, and external MCP servers are dependencies, not Pi Harness components.
_Avoid_: Pi core, agent configuration

**Agent Profile**:
A Profile resolves model, reasoning, tools, and posture prompt per fixed Mode (low/medium/high).
_Avoid_: mode, model preset

**Main Agent Tool Surface**:
The set of model-visible tools available to the main agent. Pi Harness V2 designs this surface from an empty baseline, admitting each tool only through an explicit capability decision.
_Avoid_: profile tools, default tools

**MCP Gateway**:
The single model-facing `mcp` tool supplied by `pi-mcp-adapter`; its behavior remains adapter-owned. This is distinct from MCP-backed tools pinned as static members of a specific agent toolbox.
_Avoid_: MCP tools, MCP integration

**Minimal High-Quality Primitive**:
A model-facing interface that is cohesive, predictable, composable, and materially useful. V2 minimizes total cognitive and schema surface rather than raw tool count; responsibilities with distinct lifecycles or authority boundaries remain separate.
_Avoid_: fewest tools, merged gateway, convenience tool

**Empty Tool Baseline**:
The starting state for Pi Harness V2 design in which the main agent has zero model-visible tools. It is a reasoning baseline, not a claim that the finished harness should remain tool-less.
_Avoid_: minimal toolset, default Pi tools

**Baseline Assets**:
Existing resources preserved while V2 redesigns model-visible capabilities: `SYSTEM.md`, `APPEND_SYSTEM.md`, `AGENTS.md`, skills, the external `pi-mcp-adapter` package, MCP configuration and integrations, and Pi settings. Preservation does not imply that an asset receives model-visible access.
_Avoid_: V1 harness, inherited toolset

**Bankrupt Extension Estate**:
All local code under `extensions/`, treated as carrying no assumed V2 contracts, architecture, or implementation value. It may supply evidence, but each capability must be justified and designed anew before any code is reused.
_Avoid_: extension migration, inherited extensions

**Skill Corpus**:
The existing collection under `skills/`, preserved as V2 content independently of how agents discover or load it.
_Avoid_: skill tool, skill runtime

**Skill Delivery**:
The V2 mechanism by which agents discover and load the Skill Corpus. Existing built-in and custom mechanisms carry no presumption of reuse.
_Avoid_: skill corpus, inherited skill tool

**Agent Tool**:
The single factory that turns a per-agent spec — key, parameters, mode selection, per-call plan, result finalization, recovery — into a model-visible delegation tool. finder, librarian, oracle, and task are specs, not implementations.
_Avoid_: subagent tool, tool wrapper

**Checkout Cache**:
The shared local store of partial clones of remote repositories at `~/.cache/checkouts/<host>/<org>/<repo>`, kept fresh by throttled refresh and never edited in place.
_Avoid_: clone dir, temp checkout

**Subagent**:
A delegated agent run started by the primary agent to complete a bounded assignment with its own context.
_Avoid_: child bot, worker agent

**Trace View**:
A compact presentation of tool activity that preserves full evidence behind expansion rather than changing or discarding tool output.
_Avoid_: reduced output, terse mode

**Mechanical State**:
A tool outcome derived directly from lifecycle facts such as running, succeeded, failed, cancelled, backgrounded, or exit code, without interpreting output semantics.
_Avoid_: inferred outcome, semantic summary

**Progress Signal**:
Ephemeral evidence that an active tool is advancing, shown only while it runs and omitted from the completed trace.
_Avoid_: result summary, permanent activity log
