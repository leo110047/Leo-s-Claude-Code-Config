# goldband Architecture

This document explains the boundary between goldband shared policy and
Goldband Loop, the first-party workflow runtime in this repository.

## System Shape

goldband is a local configuration and workflow distribution for Claude Code and
Codex. It has two first-party layers:

- shared policy and host adapters, owned by the root repo
- Goldband Loop runtime, owned by `goldband-loop/`

The user-facing workflow surface is `goldband-*`. The installer no longer wraps
or hides an upstream runtime; it installs Goldband Loop directly and verifies the
result against a machine-readable inventory.

## Responsibility Boundary

### Root goldband owns

- repository-level guidance and adapter docs:
  - `AGENTS.md`
  - `codex/AGENTS.md`
  - `README.md`
  - `README.en.md`
- installer and repo-linked setup:
  - `install.sh`
  - `shell/install/*.sh`
- Claude-side integration surfaces:
  - `commands/`
  - `rules/`
  - `hooks/`
- portable shared skills:
  - `skills/global/`
  - `skills/projects/`
- validation gates:
  - `scripts/check-goldband-loop-inventory.mjs`
  - `.github/workflows/validate.yml`

### goldband-loop owns

- workflow runtime source and generated host skill surfaces
- workflow-native docs, build metadata, tests, browser/PDF/design/iOS tooling
- runtime binaries under `goldband-loop/bin/goldband-*`
- the Goldband Loop inventory at `goldband-loop/inventory.json`
- inherited upstream MIT license text and attribution

Concrete ownership signals include:

- [goldband-loop/package.json](goldband-loop/package.json)
- [goldband-loop/bun.lock](goldband-loop/bun.lock)
- [goldband-loop/README.md](goldband-loop/README.md)
- [goldband-loop/ARCHITECTURE.md](goldband-loop/ARCHITECTURE.md)
- [goldband-loop/inventory.json](goldband-loop/inventory.json)

## Integration Contract

goldband installs Goldband Loop through [shell/install/workflow.sh](shell/install/workflow.sh).
That installer is responsible for:

- locating `goldband-loop/` or an explicit `GOLDBAND_LOOP_DIR`
- installing Claude runtime assets at `~/.claude/skills/goldband`
- installing Codex runtime assets at `~/.codex/skills/goldband`
- exposing workflow skills as `goldband-*`
- cleaning legacy runtime roots and generated entries from older installs
- preserving `~/.goldband` as the runtime state directory
- migrating legacy `~/.workflow` and `~/.gstack` config/state into
  `~/.goldband` without overwriting newer Goldband Loop files

The inventory gate proves the contract. It runs a clean-home install, lists the
actual Claude/Codex skill entries and runtime binaries, and fails on missing
entries, extra entries, legacy commands, or old runtime prefixes.

## Validation Gates

Root goldband and Goldband Loop use separate gates because they have different
toolchains and file-shape rules.

- Root policy, installer, hooks, commands, and portable skills are covered by
  `node scripts/check-code-style.mjs` and the root validation scripts.
- `goldband-loop/` is excluded from the root code-style scanner because it owns
  a runtime-specific Bun test suite and generated skill/docs surfaces.
- CI still treats `goldband-loop/` as first-party code: it installs the runtime
  dependencies, installs the Playwright browser asset, runs
  `node scripts/check-goldband-loop-inventory.mjs`, and then runs
  `cd goldband-loop && bun run test:free`.

## Maintenance Rules

- Treat `goldband-loop/` as first-party source, not a vendored upstream snapshot.
- Do not recreate wrapper manifests or hidden-name installer behavior.
- When adding or removing a Goldband Loop entry, update `goldband-loop/inventory.json`
  and run `node scripts/check-goldband-loop-inventory.mjs`.
- Keep Claude and Codex install paths aligned before claiming dual-tool parity.
- Keep attribution for the absorbed upstream runtime in the Goldband Loop docs.
