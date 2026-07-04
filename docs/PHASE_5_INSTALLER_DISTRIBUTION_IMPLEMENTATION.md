# Phase 5 Installer Distribution Implementation

Date: 2026-07-04

## Decision

Maintainer selected **Option B**: retire the native Windows installer and support
Windows through Git Bash / WSL running the POSIX installer from a full git
checkout.

## Deleted Surface

Deleted standalone active/prototype files:

| Area | Files | Deleted lines |
|---|---:|---:|
| Native Windows installer (`install.ps1`, `scripts/goldband-windows*.mjs`) | 10 | 2409 |
| Native Windows integration test and fixture | 2 | 991 |
| Codex plugin marketplace prototype | 3 | 57 |
| Total | 15 | 3457 |

The full diff also removes stale references from CI and docs. Remaining mentions
of the old Windows installer are limited to archival prompt/decision documents
or explicit stale-file cleanup guidance.

## Migration

Windows users should stop running `pwsh -File .\install.ps1`. Use Git Bash or
WSL from a complete checkout instead:

```bash
./install.sh all-tools
./install.sh all-with-workflow
./install.sh status
```

Older installs may leave local files that goldband no longer manages:

- `~/.claude/bin/goldband-self-update.ps1`
- `~/.claude/shell/goldband-launchers.ps1`
- `~/.claude/.goldband-windows-state.json`

`/verify-config` reports those files as stale cleanup information when present.

## Requirements Path

`./install.sh codex-requirements` remains a POSIX installer action and defaults
to `/etc/codex/requirements.toml`.

Native Windows managed requirements use
`%ProgramData%\OpenAI\Codex\requirements.toml`; goldband does not stage
`~/.codex/requirements.toml` or claim that path is enforced on Windows.

## Plugin Metadata

`.claude-plugin/plugin.json` intentionally omits an explicit `version`. Claude
plugin resolution falls back to the git commit SHA when the manifest and
marketplace entry do not provide a version, which avoids a stale manifest
version blocking updates. The remaining manifest fields are factual metadata.

## Verification

Passed:

- `python3 -m json.tool .claude-plugin/plugin.json`
- `node scripts/check-code-style.mjs`
- `npm run test:style-gate`
- `npm run test:hook-router`
- `npm run test:hook-router:coverage`
- `npm run test:eval-budget-cap`
- `python3 scripts/verify-hook-script-references.py`
- `bash scripts/verify-decision-guidance.sh`
- `node scripts/check-goldband-loop-inventory.mjs`
- `bash scripts/test-workflow-integration.sh`
- `bash scripts/check-codex-portability.sh`
- `node skills/global/claude-config-verification/scripts/verify-claude-config.js --json`
- Temp `HOME` POSIX smoke with
  `CODEX_REQUIREMENTS_FILE=<temp-home>/etc/codex/requirements.toml`:
  `all-with-workflow` -> `codex-requirements` -> `status` -> `uninstall`
- Goldband Loop Playwright setup behavior:
  - missing browser with default settings exits non-zero and prints recovery
    instructions
  - `GOLDBAND_SKIP_PLAYWRIGHT=1` exits zero and warns that browser workflows
    are unavailable
- `bash scripts/test-goldband-loop-playwright-setup.sh`

Follow-up fix:

- `all-with-workflow` triggers Goldband Loop's Playwright browser install step.
  Setup now requires a verified browser runtime by default and fails with
  recovery instructions when Playwright Chromium cannot be installed or launched.
  Offline/CI installs must explicitly set `GOLDBAND_SKIP_PLAYWRIGHT=1`, and
  managed machines may set `GOLDBAND_CHROMIUM_PATH` to a compatible Chromium
  binary.
