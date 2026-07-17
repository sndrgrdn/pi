---
name: pi-docs
description: Navigate pi package documentation, examples, and implementation.
disable-model-invocation: true
---

# Pi documentation

Use the selected pi package as the source of truth. `PI_ROOT` means its coding-agent package directory.

## 1. Resolve the package paths

Run the bundled resolver by absolute path, using the directory containing this `SKILL.md` as `<skill-dir>`:

```bash
PI_ROOT="$(node <skill-dir>/scripts/resolve-pi-root.mjs "$(command -v pi)")"
PI_README="$PI_ROOT/README.md"
PI_DOCS="$PI_ROOT/docs"
PI_EXAMPLES="$PI_ROOT/examples"
PI_CODE="$PI_ROOT/dist"
```

The resolver mirrors pi's `getPackageDir()` behavior: `PI_PACKAGE_DIR` wins; otherwise it resolves the `pi` executable and walks up to its package root. Set `PI_PACKAGE_DIR` when inspecting a source checkout or when a package-manager shim cannot reveal the installation.

Confirm that `PI_README`, `PI_DOCS`, and `PI_EXAMPLES` exist before continuing. Path resolution is complete only when all three point into the same package root.

## 2. Investigate the relevant branch

For usage or API questions:

1. Read `PI_README` and the relevant topic document completely.
2. Follow relevant Markdown cross-references and read each selected file completely.
3. Before implementing, inspect the relevant examples as well as the docs.

| Topic | Document | Example area |
|---|---|---|
| Extensions | `docs/extensions.md` | `examples/extensions/` |
| Themes | `docs/themes.md` | `examples/extensions/` |
| Skills | `docs/skills.md` | — |
| Prompt templates | `docs/prompt-templates.md` | — |
| TUI components | `docs/tui.md` | extension examples |
| Keybindings | `docs/keybindings.md` | — |
| SDK integrations | `docs/sdk.md` | `examples/sdk/` |
| Custom providers | `docs/custom-provider.md` | custom-provider extension examples |
| Models | `docs/models.md` | — |
| Packages | `docs/packages.md` | — |

For internals or behavior requiring implementation evidence:

1. Read the relevant docs first.
2. Search the resolved `PI_CODE` for the symbol or concept.
3. Trace imports, call sites, and nearby tests until the behavior is accounted for.

Useful entry points are `config.js`, `core/system-prompt.js`, `core/resource-loader.js`, `core/sdk.js`, and `core/skills.js` under `PI_CODE`.

## 3. Report from evidence

Use the resolved absolute paths in tool calls and answers. Distinguish documented behavior from implementation details. The investigation is complete when every pi-specific claim is supported by a selected doc, example, or traced source path.
