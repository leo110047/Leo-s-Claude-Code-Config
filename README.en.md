# goldband

> Shared engineering guardrails for Claude Code and Codex.

English | [中文](README.md)

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## What Is goldband

goldband is a local configuration pack for Claude Code and Codex. It connects
shared working guidance, hooks, commands, rules, portable skills, and
Goldband Loop to your local environment.

It does three main jobs:

- Keeps Claude and Codex aligned on the same basic engineering policy.
- Moves high-risk operations into hooks, permissions, and rules.
- Provides `goldband-*` workflow entry points for review, debugging, QA,
  planning, and other heavier flows.

directional recommendations are expected to surface assumptions, failure modes, alternatives, and unknowns, and directional work defaults to the healthiest maintainable path.

## goldband vs Goldband Loop

- goldband owns shared policy, installer behavior, Claude/Codex adapters, global
  guidance, hooks, commands, rules, and portable skills.
- `goldband-loop/` is the first-party workflow runtime.
- At install time, goldband installs Goldband Loop directly and exposes
  `goldband-*` entry points.

Maintenance details live in [ARCHITECTURE.md](ARCHITECTURE.md). Runtime-specific
docs live in [goldband-loop/README.md](goldband-loop/README.md).

## Installation

Claude Code users should start with the plugin path. The plugin covers the core
Claude surface: commands, portable skills, a generated rules skill from
`rules/`, and the hook router. It does not include the Goldband Loop workflow
runtime, Playwright/browser/iOS tooling, or Codex assets.

```bash
git clone https://github.com/leo110047/goldband.git
cd goldband
claude plugin marketplace add ./
claude plugin install goldband@goldband --scope user
./install.sh status
```

Uninstall the plugin:

```bash
claude plugin uninstall goldband@goldband
```

Use the installer when you need Codex, developer repo-linked setup, or the
Goldband Loop workflow runtime. Use a full git checkout. Do not copy
`install.sh` by itself:

```bash
git clone https://github.com/leo110047/goldband.git
cd goldband
```

macOS / POSIX:

```bash
./install.sh pack-quality      # Claude Code quality baseline, no workflow
./install.sh all-tools         # Claude Code + Codex
./install.sh all-with-workflow # Claude Code + Codex + bundled workflow; recommended for review/QA
./install.sh status            # Check install and app-surface status
```

Windows:

goldband no longer maintains a native PowerShell installer. On Windows, use Git
Bash or WSL from a full git checkout and run the same POSIX commands:

```bash
./install.sh all-tools
./install.sh all-with-workflow
./install.sh status
```

Install individual pieces:

```bash
./install.sh claude-guidance    # Claude global CLAUDE.md
./install.sh codex-full         # Full Codex setup
./install.sh codex-agents       # Codex AGENTS.md + custom agents
./install.sh codex-prompts      # Legacy Codex prompt fallback
./install.sh codex-hooks        # Codex hooks
./install.sh codex-requirements # Codex managed requirements
./install.sh workflow           # Claude-side workflow (standard profile)
./install.sh workflow-codex     # Codex-side workflow (standard profile)
./install.sh launchers          # shell launcher integration
./install.sh uninstall          # remove install
```

If `goldband@goldband` and installer-managed Claude assets are both installed,
`./install.sh status` reports duplicate assets, the active sources, remediation,
and exits non-zero to avoid a false all-green status.

### Support Matrix

| Surface | Status | Install path | Notes |
| --- | --- | --- | --- |
| Claude Code CLI | supported | `goldband@goldband` plugin or installer | Claude Code hooks/settings apply only here |
| Claude Desktop app | supported (portable subset) | local `.mcpb` extension | connects to first-party `goldband-mcp`; separate from Claude Code settings |
| Claude web/mobile app | supported (portable subset) | remote MCP connector | requires a deployed remote MCP endpoint and connector registration |
| Codex CLI | supported | `./install.sh codex-full` | shared Codex config |
| Codex app | supported via shared config | `./install.sh codex-full` | `./install.sh status` reads back the shared config surfaces |
| Codex plugin | supported (portable subset) | Codex repo marketplace package | skills + opt-in MCP wrapper; does not replace full setup |

Dependencies:

- Hook merging requires `jq`.
- Windows workflow installation needs `bash`; Git for Windows is recommended.
- `all-with-workflow` installs and verifies Goldband Loop's Playwright Chromium
  browser runtime; download or launch failure stops the install. Offline/CI
  runs can explicitly set `GOLDBAND_SKIP_PLAYWRIGHT=1` to skip browser
  workflows, or set `GOLDBAND_CHROMIUM_PATH` to a compatible Chromium binary.

## Installed Surface

- Claude plugin: `goldband@goldband` provides commands, portable skills, the
  hook router, and a generated `goldband-rules` skill.
- Codex plugin: portable skills, repo marketplace entry, and an opt-in MCP wrapper.
- Claude app adapters: Claude Desktop `.mcpb` local extension package and a
  remote MCP connector registration template.
- Claude installer: `claude/CLAUDE.md` -> `~/.claude/CLAUDE.md`
- Codex global guidance: `codex/AGENTS.md` -> `~/.codex/AGENTS.md`
- Claude installer assets: `commands/`, `rules/`, `hooks/`, portable skills
- Codex assets: config, profiles, prompts, rules, hooks, custom agents, portable skills
- Goldband Loop runtime: Claude uses `~/.claude/skills/goldband`; Codex uses `~/.codex/skills/goldband`
- Rules review: programmatic code review reloads, selects, and injects the
  applicable current `rules/*.md` on every run. It does not depend on writer
  self-attestation or session receipts. Deterministic checks validate manifest
  coverage, prompt payload budgets, and generated plugin distribution drift.
  `codex-hooks` materializes its resolver at
  `~/.codex/review-runtime/rules-resolver.js`, independently of whether the
  hook directory is a symlink or copied directory.

Goldband Loop uses one standard workflow discovery profile:

- It exposes one public workflow entrypoint, `goldband`; maintenance flows such
  as upgrades route through capability actions.
- Full workflow instructions remain installed under `workflows/*.workflow.md` in the runtime root and are loaded by the entrypoint skill.
- Claude users list and run workflows through `/goldband <capability> <action>`; Codex users use `$goldband <capability> <action>`.

This keeps the Claude/Codex skill list cleaner and prevents Goldband Loop workflow descriptions from crowding the skills context. The old fully expanded top-level `/goldband-qa`, `/goldband-review`, and similar workflow entries have been removed.

Global guidance only covers daily response style, verification posture, and work
boundaries. Review, debugging, security, planning, and QA flows live in
Goldband Loop workflows, commands, skills, hooks, and rules.

Regenerate app support artifacts after changing Codex plugin or Claude app
adapter sources:

```bash
npm run sync:app-support
npm run test:app-support
```

Use `npm test`, `npm run test:repo`, or `bun run test` as the repo-root default
aggregate test entrypoint. It runs an explicit set of package-owned suites and
prints a per-suite summary. Do not treat bare `bun test` at the repo root as
full-repo evidence; it bypasses package-owned test contracts and has no
per-package summary. Run `npm run test:cross-review` separately for
cross-review changes.

## Cross-Review Gate

For work that must be approved by the other host family before the implementer
can finish, arm the cross-review gate:

```bash
goldband-loop/bin/goldband-cross-review start --plan docs/plans/feature.md --reviewer codex
goldband-loop/bin/goldband-cross-review run
```

`run` defaults to the real reviewer CLI. `--review-mode mock` is only for CI and local contract tests, and mock artifacts are not accepted by the Stop gate as production approval evidence.

The Stop hook only checks deterministic evidence: the session contract, plan
marker, reviewer artifact, and current diff/untracked bundle `reviewed-sha`.
It never starts Claude or Codex from inside the hook. Claude Stop blocks through
the existing router `exit(2)` path. Codex cross-review Stop blocks through hook
process `exit(2)`: the 2026-07-05 local probe showed JSON `systemMessage` is
only advisory, while a non-zero hook exit makes Codex show `Stop Blocked` and
prevents that turn from finishing.

This is an evidence gate for preventing accidental completion and encouraging
cross-model review, not a security boundary. The implementer and reviewer run on
the same machine with the same user-level permissions, so this cannot resist a
same-permission operator intentionally forging state or artifacts. Claude also
short-circuits when `stop_hook_active` is set to avoid Stop-hook recursion,
while Codex relies on exit code `2` to re-enter the turn; the two hosts are not
interaction-identical.

If max rounds or `ESCALATE` requires human arbitration, the runtime writes an
escalation summary in the cross-review state directory and includes its path in
the Stop message. Arm, round verdict, response, escalation, override, and done
events are recorded in usage telemetry.

## Permission Boundary

Claude `hooks/hooks.json` uses `defaultMode: acceptEdits`. This is a convenience
profile for a trusted local development environment, not a sandbox. Hooks,
permissions, and deny rules reduce accidental-risk exposure, but they do not
isolate malicious or arbitrary shell commands. Broad allow patterns for command
wrappers or batch executors such as `node`, `python`, `xargs`, `find`, and `sed`
should not be restored to the source auto-allow list; if needed, approve the
specific command explicitly or place the local trust decision in an ignored
machine-local overlay.

## Codex Notes

Codex tracked config/rules are the portable baseline only. Machine-local paths,
trusted projects, plugin state, and one-off approvals live in ignored overlays:

- `codex/local/config.toml`
- `codex/local/rules/*.rules`

If an older checkout wrote approvals into `codex/rules/default.rules`:

```bash
./install.sh repair-codex-rules
```

`codex-requirements` installs Codex managed requirements. POSIX defaults to
`/etc/codex/requirements.toml`. The native Windows system path is
`%ProgramData%\OpenAI\Codex\requirements.toml`; goldband's Git Bash / WSL
install flow does not stage `~/.codex/requirements.toml` and does not claim
Windows managed-requirements enforcement.

MCP templates and token-backed setup live in [mcp/README.md](mcp/README.md).
The first-party zero-token `goldband-mcp` server lives in `mcp/server/`.
The installer does not enable it by default; build it first, then point the
`goldband` template entry at your checkout path.

## Common Entry Points

These workflow entry points require `workflow`, `workflow-codex`, or
`all-with-workflow` first:

- Claude: `/goldband`
- Codex: `$goldband <capability> <action>`
- Planning command: `/plan`
- Verification command: `/verify`

Run `/goldband` or `$goldband` with no argument to list installed
capabilities and actions. Direct examples:
`/goldband review code` on Claude, `$goldband review code` on Codex. A
`pack-quality`-only install does not expose Goldband Loop workflows.

## Updates

```bash
git pull --ff-only
./install.sh status
```

After updating, rerun the install combination you normally use, such as
`pack-quality`, `all-tools`, or `all-with-workflow`.

When launched through the goldband `claude` or `codex` launcher, goldband can
self-update only when the repo is clean, on `main`, tracking `origin/main`, and
safe to fast-forward.

## Language

```text
/goldband-language zh-TW
/goldband-language en
```

Direct config:

```bash
~/.codex/skills/goldband/bin/goldband-config set goldband_language zh-TW
~/.codex/skills/goldband/bin/goldband-config set goldband_language en
```

Restart Claude Code or Codex if the current session does not pick up the change.

## When Not to Use goldband

- You do not use Claude Code or Codex.
- You only want a generic project template.
- You do not want hooks, permissions, repo-linked install, or startup self-update.
- You only want the Goldband Loop runtime.

If you only need the runtime, start with
[goldband-loop/README.md](goldband-loop/README.md).

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Install looks incomplete | Run `./install.sh status` |
| Hooks are not running | Run `./install.sh hooks` and make sure `jq` is installed |
| `/verify-config` reports errors | Rerun `./install.sh all-tools` or `./install.sh all-with-workflow` |
| Language changes do not show up | Restart Claude Code or Codex |
| Startup self-update does not run | Verify the repo was cloned with git, is on `main`, is clean, and tracks `origin/main` |
| Codex approvals were written into tracked rules | Run `./install.sh repair-codex-rules` |

## License

MIT License.
