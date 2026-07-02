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

## MCP Templates

MCP templates live under `mcp/` and are disabled by default. Before documenting a
server as supported, run MCP Inspector and verify that the server starts and
lists the expected tools.
