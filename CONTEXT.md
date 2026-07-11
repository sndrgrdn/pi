# Pi Agent Extensions

This context describes the language for local Pi agent extensions, especially delegated agent execution.

## Language

**Pi Harness**:
The maintained layer over Pi core comprising profiles, prompts, custom tools, the subagent runtime, skills, session workflows, and instrumentation. Pi core, model providers, and external MCP servers are dependencies, not Pi Harness components.
_Avoid_: Pi core, agent configuration

**Agent Profile**:
A named operating configuration for the main agent. Which properties profiles may vary is unresolved for V2.
_Avoid_: mode, model preset

**Main Agent Tool Surface**:
The set of model-visible tools available to the main agent. Pi Harness V2 designs this surface from an empty baseline, admitting each tool only through an explicit capability decision.
_Avoid_: profile tools, default tools

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

**Subagent**:
A delegated agent run started by the primary agent to complete a bounded assignment with its own context.
_Avoid_: child bot, worker agent


**Parallel Task Limit**:
The maximum number of subagent assignments accepted in a single batched subagent tool call.
_Avoid_: concurrency limit, worker count

**Subagent Concurrency**:
The maximum number of accepted subagent assignments that may run at the same time.
_Avoid_: parallel task limit, batch size

**Output Cap**:
A maximum size for subagent result text retained by the subagent tool to keep parent-agent context and tool results bounded.
_Avoid_: transcript limit, context window

**Subagent Session Directory**:
The shared session storage directory for subprocess-backed subagent runs, separate from project-specific resume directories while still retaining JSONL history and usage data.
_Avoid_: hidden session, log directory
