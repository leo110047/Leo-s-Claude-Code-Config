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
- `goldband-loop/` is the first-party workflow runtime, not a vendored upstream.
- At install time, goldband installs Goldband Loop directly and exposes
  `goldband-*` entry points.

Maintenance details live in [ARCHITECTURE.md](ARCHITECTURE.md). Runtime-specific
docs live in [goldband-loop/README.md](goldband-loop/README.md).

## Installation

Use a full git checkout. Do not copy `install.sh` by itself:

```bash
git clone https://github.com/leo110047/goldband.git
cd goldband
```

macOS / POSIX:

```bash
./install.sh pack-quality      # Claude Code quality baseline, no workflow
./install.sh all-tools         # Claude Code + Codex
./install.sh all-with-workflow # Claude Code + Codex + bundled workflow; recommended for review/QA
./install.sh status            # Check status
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
./install.sh codex-hooks        # Codex hooks
./install.sh codex-requirements # Codex managed requirements
./install.sh workflow           # Claude-side workflow
./install.sh workflow-codex     # Codex-side workflow
./install.sh launchers          # shell launcher integration
./install.sh uninstall          # remove install
```

Dependencies:

- Hook merging requires `jq`.
- Windows workflow installation needs `bash`; Git for Windows is recommended.
- `all-with-workflow` installs and verifies Goldband Loop's Playwright Chromium
  browser runtime; download or launch failure stops the install. Offline/CI
  runs can explicitly set `GOLDBAND_SKIP_PLAYWRIGHT=1` to skip browser
  workflows, or set `GOLDBAND_CHROMIUM_PATH` to a compatible Chromium binary.

## Installed Surface

- Claude global guidance: `claude/CLAUDE.md` -> `~/.claude/CLAUDE.md`
- Codex global guidance: `codex/AGENTS.md` -> `~/.codex/AGENTS.md`
- Claude assets: `commands/`, `rules/`, `hooks/`, portable skills
- Codex assets: config, profiles, rules, hooks, custom agents, portable skills
- Goldband Loop runtime: Claude uses `~/.claude/skills/goldband`; Codex uses `~/.codex/skills/goldband`

Global guidance only covers daily response style, verification posture, and work
boundaries. Review, debugging, security, planning, and QA flows live in
`goldband-*` workflows, commands, skills, hooks, and rules.

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
Codex modernization status lives in
[docs/CODEX_MODERNIZATION.md](docs/CODEX_MODERNIZATION.md).

## Common Entry Points

These workflow entry points require `workflow`, `workflow-codex`, or
`all-with-workflow` first:

- `/plan`
- `/verify`
- `/goldband-review`
- `/goldband-investigate`
- `/goldband-cso`
- `/goldband-design-review`
- `/goldband-qa`
- `/goldband-benchmark`
- `/goldband-skillify`

Full reviews use the `/goldband-review` workflow. A `pack-quality`-only install
does not expose a review entry point.

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
Goldband Loop upstream attribution is preserved in [goldband-loop/UPSTREAM_ATTRIBUTION.md](goldband-loop/UPSTREAM_ATTRIBUTION.md).
