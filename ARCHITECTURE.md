# goldband Architecture

This document explains the responsibility boundary between goldband and the vendored `workflow` runtime.

## System Shape

goldband is not the `workflow` product itself. It is the integration and policy layer that:

- defines shared engineering guidance for Claude Code and Codex
- installs repo-linked commands, contexts, rules, hooks, and portable skills
- adapts the vendored `workflow` runtime into `goldband-*` user-facing entry points
- keeps Claude-side and Codex-side behavior aligned

## Responsibility Boundary

### goldband owns

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
  - `contexts/`
  - `rules/`
  - `hooks/`
- portable shared skills:
  - `skills/global/`
  - `skills/projects/`

### vendor/workflow owns

- the bundled high-level runtime source tree
- workflow-native docs, packaging, release notes, and build metadata
- workflow-native skill implementations and runtime binaries
- workflow-specific architecture and product philosophy

Concrete signals that `vendor/workflow` is a self-contained upstream project include:

- [vendor/workflow/package.json](vendor/workflow/package.json)
- [vendor/workflow/bun.lock](vendor/workflow/bun.lock)
- [vendor/workflow/README.md](vendor/workflow/README.md)
- [vendor/workflow/ARCHITECTURE.md](vendor/workflow/ARCHITECTURE.md)
- [vendor/workflow/CHANGELOG.md](vendor/workflow/CHANGELOG.md)

## Integration Contract

goldband consumes the vendored runtime through the installer layer, primarily in [shell/install/workflow.sh](shell/install/workflow.sh).

That installer is responsible for:

- locating the runtime source
- installing it into Claude / Codex runtime locations
- generating `goldband-*` wrappers from workflow skills
- hiding workflow root entries when goldband wants curated user-facing names
- keeping wrapper language and runtime path rewrites consistent

The key point is:

- `workflow` provides the runtime and skill source
- goldband provides the curated installation, naming, policy, and host integration

## Why the runtime is vendored

`vendor/workflow` lives inside this repo so goldband can:

- ship one repo that installs both shared policy and bundled runtime
- pin a tested runtime snapshot
- apply integration-layer wrapper generation without making the end user manage a second checkout

This makes the repository boundary more important, not less. The vendored runtime should be treated as an upstream subtree/source snapshot, while goldband-specific policy and adapters should remain outside it.

## Maintenance Rules

- Do not duplicate workflow product docs in root README; link to `vendor/workflow/README.md` or this file instead.
- Do not treat workflow internals as goldband policy sources of truth.
- When changing wrapper behavior or install paths, document the change in root docs and keep the boundary explicit.
