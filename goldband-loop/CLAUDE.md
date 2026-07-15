# Goldband Loop Claude Adapter

This subtree implements the Goldband workflow runtime. Follow the repository
root [`CLAUDE.md`](../CLAUDE.md) for shared engineering policy; keep this file as
a small Claude Code adapter instead of duplicating workflow manuals or durable
rules.

## Public Interface

- [`goldband.manifest.json`](../goldband.manifest.json) is the source of truth
  for capabilities and actions.
- The generated [capability catalog](../docs/generated/capabilities.md) is the
  authoritative human-readable inventory.
- Claude Code uses `/goldband <capability> <action>`.
- Codex uses `$goldband <capability> <action>`.
- Historical flat workflow names are not aliases. Do not route to or document
  them as fallback entrypoints.

## Editing Contract

- Edit workflow prompt contracts in `../goldband.manifest.json`; the root
  `SKILL.md.tmpl` only owns the small capability router.
- Change capability metadata in `../goldband.manifest.json`, then regenerate all
  derived surfaces.
- Put runtime details in `ARCHITECTURE.md`, workflow contracts, tests, or design
  documents instead of this adapter.

## Verification

From the repository root:

```bash
node scripts/generate-goldband-surfaces.mjs --check
cd goldband-loop && bun test test/workflows-registry.test.ts
```

Run the broader test command appropriate to the changed subsystem before
claiming the change is safe.
