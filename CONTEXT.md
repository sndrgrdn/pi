# Pi Agent Extensions

This context describes the language for local Pi agent extensions, especially delegated agent execution.

## Language

**Subagent**:
A delegated agent run started by the primary agent to complete a bounded assignment with its own context.
_Avoid_: child bot, worker agent

**Subagent Tool**:
The extension-provided tool that lets the primary agent start one or more subagents and collect their results.
_Avoid_: task tool, swarm

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
