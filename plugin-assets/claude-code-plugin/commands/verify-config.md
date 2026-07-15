---
description: Health check for the goldband installation, generated assets, and repo policy gates.
---

# Verify Config

Run a script-first health check and report the current state. Prefer existing
commands over manually re-implementing checks in the prompt.

If the `quick` argument is provided, check only installed Claude/Codex assets
and hook wiring. Otherwise run the full sequence below.

## Commands

From the repo root:

```bash
node skills/global/claude-config-verification/scripts/probe-plugin-data.js
./install.sh status
npm run test:app-support
bash scripts/verify-decision-guidance.sh
node scripts/check-goldband-loop-inventory.mjs
python3 scripts/verify-hook-script-references.py
```

If `codex` is available, also verify policy routing:

```bash
codex execpolicy check --rules codex/rules/default.rules -- git status --short
codex execpolicy check --rules codex/rules/default.rules -- git push origin main
codex execpolicy check --rules codex/rules/default.rules -- rm README.md
```

## Required Readback

Report these sections:

- Plugin data: whether `CLAUDE_PLUGIN_DATA` exists, is readable/writable, or
  fell back to temp storage.
- Claude install: skills, commands, rules, hooks, global `CLAUDE.md`, and POSIX
  shell launcher status.
- Codex install: `~/.codex/AGENTS.md`, generated config, rules, hooks, and
  `~/.agents/skills` profile metadata.
- App surfaces: Codex plugin package, Claude Desktop local extension, and
  Claude remote MCP connector assets from `./install.sh status`.
- Goldband Loop runtime when installed: `SKILL.md`, `bin/goldband-config`,
  `manuals/browser.md`, and generated workflow contracts including
  `workflows/investigate/code.workflow.md`,
  `workflows/review/code.workflow.md`, and `workflows/qa/app.workflow.md`.
- Hook checks: configured hook count and whether every referenced script
  exists.
- Repo validation: JSON/TOML parse status, decision guidance parity,
  Goldband Loop inventory, hook script references, app support, and Codex
  execpolicy results.

## Output

Use a compact report:

```text
goldband Health Check

Plugin Data: OK/WARNING/ERROR - ...
Claude Install: OK/WARNING/ERROR - ...
Codex Install: OK/WARNING/ERROR - ...
App Surfaces: OK/WARNING/ERROR - ...
Workflow Runtime: OK/WARNING/ERROR/INFO - ...
Hooks: OK/WARNING/ERROR - ...
Repo Validation: OK/WARNING/ERROR - ...

Summary: X OK, Y WARNING, Z ERROR
```

Say clearly when a result is local-only, unavailable because a CLI is missing,
or unverified because a command could not run.
