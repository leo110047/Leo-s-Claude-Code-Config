# goldband Architecture

This document explains the boundary between goldband shared policy and
Goldband Loop, the first-party workflow runtime in this repository.

## System Shape

goldband is a local configuration and workflow distribution for Claude Code and
Codex. It has two first-party layers:

- shared policy and host adapters, owned by the root repo
- Goldband Loop runtime, owned by `goldband-loop/`
- optional local sandbox execution, owned by `sandbox/`

The user-facing workflow surface is `goldband-*`. The installer installs
Goldband Loop directly and verifies the result against a machine-readable
inventory.

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
- first-party MCP surface:
  - `mcp/server/`
  - `mcp/first-party-servers.json`
  - `mcp/*.template`
- portable shared skills:
  - `skills/global/`
  - `skills/projects/`
- validation gates:
  - `scripts/check-goldband-loop-inventory.mjs`
  - `scripts/test-sandbox.sh`
  - `.github/workflows/validate.yml`

### goldband-loop owns

- workflow runtime source and generated host skill surfaces
- programmatic workflow contracts under `goldband-loop/workflows/`
- workflow-native docs, build metadata, tests, browser/PDF/design/iOS tooling
- runtime binaries under `goldband-loop/bin/goldband-*`
- the Goldband Loop inventory at `goldband-loop/inventory.json`

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
- migrating legacy workflow config/state into `~/.goldband` without overwriting
  newer Goldband Loop files

The inventory gate proves the contract. It runs a clean-home install, lists the
actual Claude/Codex skill entries and runtime binaries, and fails on missing
entries, extra entries, legacy commands, or old runtime prefixes.

## Programmatic Workflow Runtime

`goldband-loop/workflows/` is the runtime contract layer for workflow execution.
Markdown skills and `.tmpl` files remain the user-facing entrypoints and human
guidance, but they are no longer the only source of truth for migrated workflows.
The registry records the executable contract: target, evaluation signal,
iteration cap, stop conditions, risk level, integration status, and evidence
policy.

This layer deliberately does not replace the existing inventory or usage
telemetry:

- `goldband-loop/inventory.json` remains the installed skill list.
- `hooks/scripts/lib/hook-router/workflow-telemetry.js` remains the workflow
  usage event builder.
- `goldband-loop/hosts/*.ts` remains the host generation/support source.
- `goldband-loop/workflows/registry.ts` owns runtime execution status and step
  contracts only.

Integrated runtime runs write step evidence to
`${GOLDBAND_HOME:-$HOME/.goldband}/workflow-runs/<workflow>.jsonl`. Core
workflows can run in mock mode for CI without LLM spend; real host execution is
gated behind explicit `--mode real`.
For review workflows, untracked worktree files cross an additional trust
boundary before real host execution: only bounded text files without secret-like
content are materialized into the prompt, while skipped files are recorded as
no-content markers.
The workflow runner is currently single-pass: iteration caps and stop
conditions are recorded as contract metadata, but convergence loops are not yet
autonomously executed by the runtime.

## Validation Gates

Root goldband and Goldband Loop use separate gates because they have different
toolchains and file-shape rules.

- Root policy, installer, hooks, commands, and portable skills are covered by
  `node scripts/check-code-style.mjs` and the root validation scripts.
- The first-party stdio MCP server is a separate TypeScript package under
  `mcp/server/`; it uses the official `@modelcontextprotocol/sdk`, stays
  read-only, and is opt-in in Claude/Codex MCP templates.
- `goldband-loop/` is excluded from the root code-style scanner because it owns
  a runtime-specific Bun test suite and generated skill/docs surfaces.
- CI still treats `goldband-loop/` as first-party code: it installs the runtime
  dependencies, installs the Playwright browser asset, runs
  `node scripts/check-goldband-loop-inventory.mjs`, and then runs
  `cd goldband-loop && bun run test:free`.
- The sandbox story is additive defense in depth. `sandbox/sandbox.sh` starts a
  Docker/Podman container with goldband baked into a non-writable
  `/opt/goldband`, a clean container HOME, and one target project mounted
  read-write. It does not change hook router or permission defaults.
  `scripts/test-sandbox.sh` proves the image builds, goldband installs through
  the normal clean-home path during image build, hook replay still blocks
  representative unsafe commands, CLI smoke checks run, installed Goldband Loop
  helper commands write runtime state under container HOME, `/opt/goldband` is
  not writable at runtime, the launcher happy path works, and an unmounted host
  path is not writable.
- CI runs the sandbox build as a real validation gate. Buildx cache reduces
  repeat cost on GitHub Actions, but a cold push or pull request still pays for
  a full image build and global CLI install.

## Maintenance Rules

- Treat `goldband-loop/` as first-party source.
- Do not recreate wrapper manifests or hidden-name installer behavior.
- When adding or removing a Goldband Loop entry, update `goldband-loop/inventory.json`
  and run `node scripts/check-goldband-loop-inventory.mjs`.
- Keep Claude and Codex install paths aligned before claiming dual-tool parity.
- Keep sandbox claims limited to the boundaries verified in
  [sandbox/THREAT-MODEL.md](sandbox/THREAT-MODEL.md). Do not present the
  container as host-complete security or network isolation unless a matching
  enforcement test exists.
