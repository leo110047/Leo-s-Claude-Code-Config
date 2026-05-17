# Machine-local Codex overlays

Files in this directory are intentionally ignored except for this README and
example files. Use them for machine-specific Codex state that should not become
part of goldband's portable baseline.

Supported local files:

- `config.toml`: merged with `codex/config.toml` when installing Codex config.
- `rules/*.rules`: linked into `~/.codex/rules` alongside portable rules.

Keep personal paths, trusted projects, local marketplace caches, plugin runtime
state, and one-off command approvals here.

The installer emits root-level TOML keys before any table and then emits table
sections. Do not duplicate keys or table names that already exist in the
portable baseline.
