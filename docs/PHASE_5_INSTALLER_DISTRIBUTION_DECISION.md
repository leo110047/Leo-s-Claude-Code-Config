# Phase 5 Installer Distribution Decision

Date: 2026-07-04
Status: Accepted, Option B
Source of truth: `docs/ARCHITECTURE_REVIEW_2026_07.md` Phase 5 and
`docs/prompts/phase-5-installer-distribution.md`

## Current Baseline

This baseline was recalculated from the current worktree, not copied from the
architecture review snapshot.

| Surface | Files | Lines | Evidence command |
|---|---:|---:|---|
| POSIX entrypoint `install.sh` | 1 | 321 | `wc -l install.sh` |
| POSIX installer modules `shell/install/*.sh` | 8 | 2085 | `find shell/install -type f -name '*.sh' -print \| sort \| xargs wc -l` |
| Windows installer `scripts/goldband-windows*.mjs` | 9 | 2400 | `git ls-tree -r --name-only HEAD scripts \| rg '^scripts/goldband-windows.*\.mjs$' \| while read -r f; do git show HEAD:"$f"; done \| wc -l` |
| Windows PowerShell shim `install.ps1` | 1 | 9 | `git show HEAD:install.ps1 \| wc -l` |
| Windows installer total | 10 | 2409 | `{ git show HEAD:install.ps1; git ls-tree -r --name-only HEAD scripts \| rg '^scripts/goldband-windows.*\.mjs$' \| while read -r f; do git show HEAD:"$f"; done; } \| wc -l` |

Other current facts:

- `.claude-plugin/plugin.json` declares `x-goldband.packs` and
  `x-goldband.release` with semver, biweekly cadence, and `stable` / `rc`
  channels.
- `codex/plugin-marketplace/` is explicitly documented as a placeholder and
  contains only a prototype marketplace plus a placeholder Codex plugin
  manifest.
- POSIX `codex-requirements` installs to `/etc/codex/requirements.toml` by
  default.
- Windows `codex-requirements` stages to `~/.codex/requirements.toml` and labels
  the enforcement path unverified.

## External Fact Check

Claude Code plugin mechanism is real enough for distribution, but it does not
make the current `plugin.json` pack/release promises true by itself.

- Official Claude Code docs describe plugins as self-contained directories with
  a `.claude-plugin/plugin.json` manifest, plus root-level `skills/`,
  `commands/`, `agents/`, `hooks/`, `.mcp.json`, `.lsp.json`, `monitors/`,
  `bin/`, and `settings.json` assets.
- Plugin skills are namespaced as `/plugin-name:skill-name`.
- Local development can use `claude --plugin-dir ./my-plugin` or a zip archive.
- Marketplace distribution is real: users add marketplaces, then install
  plugins with `/plugin install plugin-name@marketplace-name`.
- Version resolution uses `plugin.json` `version`, marketplace-entry `version`,
  then git commit SHA. If `plugin.json` has a stale explicit version, updates
  are skipped until the version changes.
- Stable/latest channels require separate marketplaces pointing to different
  refs or SHAs. A manifest field that merely says `"channels": ["stable", "rc"]`
  does not create channels.

Official sources:

- https://code.claude.com/docs/en/plugins
- https://code.claude.com/docs/en/discover-plugins
- https://code.claude.com/docs/en/plugin-marketplaces
- https://code.claude.com/docs/en/plugins-reference

Codex managed requirements are also documented, and the Windows load path is
not `~/.codex/requirements.toml`.

- Codex checks requirement sources in this precedence: cloud-managed
  requirements, macOS managed preferences, then system `requirements.toml`.
- System `requirements.toml` path is `/etc/codex/requirements.toml` on Unix and
  `%ProgramData%\OpenAI\Codex\requirements.toml` on Windows.
- For Codex 0.138.0 or later, OpenAI recommends permission profiles with
  `allowed_permission_profiles` and managed `default_permissions`; legacy
  `allowed_sandbox_modes` is for older deployments.
- Windows support for experimental network requirements is still limited and
  should not be applied broadly without testing.

Official source:

- https://developers.openai.com/codex/enterprise/managed-configuration
  (fetched through the official Codex manual on 2026-07-04)

## Option A: Move Claude Distribution to Plugin

Claude-side install becomes plugin-first. POSIX installer remains for Codex and
git style-gate. `.claude-plugin/plugin.json` becomes a real manifest, and the
repo gains actual Claude plugin packaging and marketplace distribution.

### Deletion Potential

Immediate safe deletion is low until the plugin package is built and verified.
If the plugin fully replaces Claude-side install, candidate POSIX code to remove
or shrink includes parts of:

- `shell/install/profiles.sh` and profile skill install paths.
- Claude guidance / commands / rules / hooks install paths in
  `shell/install/common.sh`, `shell/install/status.sh`, and
  `shell/install/uninstall.sh`.
- Claude launcher status/install paths if plugin distribution also owns startup
  update behavior, which the official plugin docs do not appear to replace.

This cannot be counted as a simple file deletion today because the POSIX modules
mix Claude and Codex behavior. The likely first implementation would add
plugin packaging before deleting installer lines, so Phase 5 would initially
increase surface area.

Hard lower bound: deleting only Windows remains unrelated to Option A. Deleting
Claude installer support cleanly would require a follow-up split of the shared
POSIX modules before line counts become exact.

### Migration for Existing Users

1. Update Claude Code to a version with `/plugin`.
2. Add the goldband marketplace or load the local plugin:
   `claude --plugin-dir ./goldband` during development, then
   `/plugin install goldband@<marketplace>` for real distribution.
3. Remove or disable old standalone Claude assets after plugin install:
   `~/.claude/skills`, `~/.claude/commands`, `~/.claude/hooks/scripts`, and
   related settings entries.
4. Rerun `./install.sh codex-full` or `./install.sh all-tools` only for Codex
   and non-plugin assets.

### Risks

- Plugin skills are namespaced, so existing `/goldband-review` style entrypoints
  may become `/goldband:goldband-review` unless the package design preserves
  shortcuts another way.
- Official plugin `settings.json` currently supports only limited defaults
  (`agent` and `subagentStatusLine`), so plugin distribution does not obviously
  replace global Claude guidance (`CLAUDE.md`) or every current settings behavior.
- A real stable/rc channel requires marketplace refs or SHAs, not only manifest
  metadata.
- This option is product-directionally stronger but too large for a safe
  immediate Phase 5 unless we accept a multi-step packaging migration.

### Fit

Best if the next product goal is public or team distribution through Claude Code
marketplaces. Worst if the near-term goal is reducing installer maintenance now.

## Option B: Keep POSIX Installer, Drop Native Windows Installer

Support Windows through Git Bash / WSL and remove the parallel native
PowerShell/Node installer implementation.

### Direct Deletion

| Deletion | Files | Lines |
|---|---:|---:|
| `install.ps1` | 1 | 9 |
| `scripts/goldband-windows*.mjs` | 9 | 2721 |
| Direct installer deletion total | 10 | 2730 |

Follow-on deletion or rewrite depends on how much Windows-specific test and
fixture code remains useful:

| Affected file | Lines | Required change |
|---|---:|---|
| `scripts/test-windows-platform-integration.mjs` | 532 | Delete or replace with a Git Bash/WSL install smoke |
| `scripts/lib/windows-platform-test-fixtures.mjs` | 459 | Delete if the native Windows test is deleted |
| `.github/workflows/validate.yml` | 118 | Remove or replace `Test Windows platform integration` |
| `README.md` | 204 | Remove PowerShell installer commands; document Git Bash / WSL |
| `README.en.md` | 197 | Same as Chinese README |
| `commands/verify-config.md` | 203 | Remove native PowerShell launcher expectations |

The conservative count for code deleted is 2730 lines / 10 files. If the native
Windows integration test and fixture are also removed instead of rewritten, the
delete count becomes 3721 lines / 12 files before docs/CI edits.

### Migration for Existing Users

1. Stop using `pwsh -File .\install.ps1 ...`.
2. Install Git for Windows and run the POSIX installer from Git Bash, or use WSL.
3. Rerun the install command that matches the desired profile:
   `./install.sh all-tools` or `./install.sh all-with-workflow`.
4. Manually remove old native Windows artifacts created by the previous
   PowerShell installer:
   `~/.claude/bin/goldband-self-update.ps1`,
   `~/.claude/shell/goldband-launchers.ps1`,
   `~/.claude/.goldband-windows-state.json`, and the PowerShell profile block.
5. Treat Windows Codex managed requirements as not installed by goldband unless
   an administrator installs `%ProgramData%\OpenAI\Codex\requirements.toml`.

### Blast Radius

- `README.md` and `README.en.md`: remove PowerShell install examples; state
  Windows support is Git Bash / WSL only.
- Windows integration test: delete native test or replace with a smaller
  fixture that proves Git Bash-compatible install paths.
- Windows fixture: remove `install.ps1` and native Windows script copying.
- `commands/verify-config.md`: remove PowerShell launcher and native Windows
  state expectations; make POSIX launcher and Codex paths platform-aware.
- PowerShell launchers and self-update: remove `goldband-self-update.ps1`,
  `goldband-launchers.ps1`, PowerShell profile mutation, and related status
  checks.
- `shell/goldband-self-update.sh` and POSIX launchers: verify no references to
  deleted native Windows scripts remain.
- CI: remove or replace `node scripts/test-windows-platform-integration.mjs`.
- Whole repo grep must return no live references to `install.ps1`,
  `goldband-windows*.mjs`, and native Windows launcher paths except historical
  docs or the Phase 5 decision record.

### Risks

- Native Windows users lose a one-command PowerShell install path.
- Existing native Windows installs need cleanup instructions because deleting
  the installer does not remove already-installed local files.
- Git Bash behavior still needs a smoke test. Do not claim Windows support
  without proving the intended path.

### Fit

Best if the goal is immediate maintenance reduction and factual docs. It also
aligns with the Codex requirements finding: the current native Windows staging
path is not an enforced managed requirements path.

## Empty-Promise Cleanup Required Either Way

These should be implemented after the A/B decision:

1. `.claude-plugin/plugin.json`
   - If Option A is selected, make it a real plugin manifest and set release
     behavior to match the actual marketplace/versioning flow.
   - If Option B is selected, remove `x-goldband.release` and likely
     `x-goldband.packs` until there is real plugin packaging. Keep only factual
     metadata.
2. `codex/plugin-marketplace/`
   - Either build an actual plugin marketplace with installable assets, or
     delete the placeholder directory and update docs.
   - Current Codex plugin marketplace state is only a placeholder, so deleting
     is the smaller honest move unless Codex plugin distribution is actively
     implemented now.
3. Windows managed requirements
   - POSIX can keep `/etc/codex/requirements.toml`.
   - Native Windows should not stage to `~/.codex/requirements.toml` as if that
     mattered. The documented system path is
     `%ProgramData%\OpenAI\Codex\requirements.toml`.
   - If native Windows installer is removed, document that Windows managed
     requirements must be installed by admin policy or manually to ProgramData,
     not by goldband's Git Bash path.

## Recommendation

Choose Option B for Phase 5.

Reason: Phase 5 is specifically about reducing installer implementation count
and removing false claims. Option B deletes a concrete 2730 lines / 10 files
immediately, has a clear blast radius, and does not depend on a new marketplace
release process. Option A is now technically possible according to Claude Code
docs, but making it true requires a real plugin package, a marketplace, version
strategy, channel strategy, migration plan, and entrypoint-namespace decision.
That is a distribution project, not a small installer slimming pass.

Suggested follow-up: after Option B lands, open a separate plugin-distribution
phase for Claude marketplace packaging if public/team distribution remains a
goal.

## Maintainer Decision

The maintainer selected **Option B**. Implement native Windows installer removal,
support Windows through Git Bash / WSL, and remove placeholder promises.
