# Persist Subagent Records as native Pi sessions

Agent Tool Subagents use separate native Pi sessions in the dedicated subagent directory whenever their immediate caller is persistent, with `parentSession` recording the full Delegation Lineage. This restores V1's durable inspection without adding children to the Current Folder session list, avoids a Harness-specific transcript store, and preserves context isolation; ephemeral callers and internal recovery runs remain in memory.
