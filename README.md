# Mori (守)

Personal harness around [pi](https://github.com/earendil-works/pi-mono/tree/main/packages/coding-agent).[^1]

Mori is a constrained main-agent tool surface, mode-based model profiles, delegated specialist agents, local skills, and custom terminal UI. The Git repository lives at `~/.pi`; Pi's runtime configuration remains under `~/.pi/agent`, where Pi discovers it.

The intended way to run Mori is `pi --no-builtin-tools` (`pi -nbt`), which disables Pi's built-in tools by default while keeping extension and custom tools enabled.

## Local setup

Some user-specific configuration is intentionally ignored by Git:

- Create `agent/APPEND_SYSTEM.md` with your personal appended system instructions. The file must exist for delegated tasks; it may be empty.
- Authenticate your model providers through Pi. Credentials are stored locally in the ignored `agent/auth.json`.
- Set `EXA_API_KEY` to enable the `web_search` and `web_fetch` tools. They also accept an `exa` API key stored by Pi in `agent/auth.json`.
- To use the same MCP integration, configure servers in `agent/mcp.json`. MCP credentials and caches also remain local.

[^1]: 守 *mori* — "keeper, protector." A tool that serves long enough earns a spirit (付喪神); this one helps tend the garden.
