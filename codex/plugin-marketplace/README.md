# Codex Plugin Marketplace Packaging Placeholder

This directory is a packaging placeholder, not an installed marketplace.

The placeholder keeps Codex marketplace shape separate from the active installer
so goldband can evolve toward plugin distribution without changing the current
repo-linked install contract. It is not a functional plugin distribution yet:
the active installers remain `install.sh` and `scripts/goldband-windows.mjs`.

To validate the prototype shape:

```bash
python3 -m json.tool codex/plugin-marketplace/marketplace.json
python3 -m json.tool codex/plugin-marketplace/plugins/goldband/.codex-plugin/plugin.json
```

When this moves from packaging placeholder to active distribution, the
marketplace root must be installed explicitly with Codex plugin marketplace
tooling and the plugin payload must include every installable asset it
advertises, including skills, hooks, agents, rules, and MCP configuration.
