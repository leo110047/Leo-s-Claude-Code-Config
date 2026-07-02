# goldband Operations

## Codex Portable Baseline Check

Run this before publishing changes to tracked Codex config or rules:

```bash
bash scripts/check-codex-portability.sh
```

This verifies that tracked Codex baseline files do not contain machine-local
paths, credential-shaped values, or one-off approvals that belong in
`codex/local/`.

## Suggested Automation

Use a local scheduled task outside this repo when you want recurring checks. The
repo does not install scheduled jobs by default.

Weekly check:

```bash
cd /path/to/goldband
bash scripts/check-codex-portability.sh
./scripts/check-skills.sh
python3 scripts/verify-hook-script-references.py
node scripts/check-code-style.mjs
```

If `codex/rules/default.rules` becomes dirty with local approvals, run:

```bash
./install.sh repair-codex-rules
```

## Codex Hooks

`./install.sh codex-core`, `./install.sh codex-full`, and `./install.sh
all-tools` install:

- `~/.codex/hooks.json`
- `~/.codex/hooks/hook-router.js`

Codex may require hook trust review after hook definitions change. Use `/hooks`
inside Codex to inspect and trust hook definitions.

## Git Style Gate

Install or refresh the global git style gate:

```bash
./install.sh style-gate
git config --global --get core.hooksPath
```

Expected goldband value:

```text
/path/to/goldband/git-hooks
```

Default install packs do not change global git settings; run `style-gate`
explicitly when you want the machine-wide hook. The pre-commit hook checks only
staged files. Biome checks run only when the target repo has `biome.json`;
otherwise the hook keeps the zero-dependency checks and emits an advisory. If
the repo-linked goldband script or `node` is unavailable, the hook warns and
allows the commit so one broken goldband checkout does not block every repo on
the machine. The commit-msg Conventional Commits gate is installed but enforced
only when the repo has `.goldband-git-workflow.json` or
`GOLDBAND_GIT_WORKFLOW_GATE=1`.

A repo can opt out permanently by adding `.goldband-no-style-gate`, or
temporarily with:

```bash
GOLDBAND_STYLE_GATE=0 git commit
```

Temporary bypasses print a warning and write a local log under
`${XDG_STATE_HOME:-$HOME/.local/state}/goldband/style-gate-bypass.log`.

If a repo uses Husky or another local `core.hooksPath`, git uses the local value
instead of the global goldband hook. That is expected.

## MCP Templates

MCP templates live under `mcp/` and are disabled by default. Before documenting a
server as supported, run MCP Inspector and verify that the server starts and
lists the expected tools.
