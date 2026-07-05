# Goldband Loop

Goldband Loop is goldband's first-party workflow runtime for AI coding agents.
It provides the heavier `goldband-*` workflows used for planning, review,
debugging, QA, browser automation, release checks, documentation, and team
maintenance.

This directory is maintained as first-party source inside the goldband
repository.

## What It Provides

- Workflow skills such as `goldband-review`, `goldband-investigate`,
  `goldband-qa`, `goldband-ship`, `goldband-autoplan`, and
  `goldband-document-generate`.
- Runtime binaries under [bin/](bin/) for config, telemetry, browser control,
  memory sync, review logs, relinking, and setup helpers.
- Browser, PDF, design, iOS QA, benchmark, eval, and documentation tooling.
- Host adapters for Claude Code, Codex, and other supported coding-agent hosts.
- A machine-readable install inventory in [inventory.json](inventory.json).

Root goldband owns shared policy, installer behavior, hooks, rules, commands,
and portable skills. Goldband Loop owns the runtime surface installed by the
`workflow`, `workflow-codex`, and `all-with-workflow` install profiles.

## Install

Most users should install from the root goldband repository, not from this
directory directly:

```bash
git clone https://github.com/leo110047/goldband.git
cd goldband
./install.sh all-with-workflow
./install.sh status
```

Install just the Claude Code runtime:

```bash
./install.sh workflow
./install.sh workflow-slim
```

Install just the Codex runtime:

```bash
./install.sh workflow-codex
./install.sh workflow-codex-slim
```

Use a local runtime checkout explicitly:

```bash
GOLDBAND_LOOP_DIR=./goldband-loop ./install.sh all-with-workflow
```

## Direct Runtime Setup

Direct setup is mainly for runtime development or host-adapter testing:

```bash
cd goldband-loop
bun install
./setup --host claude --prefix
./setup --host codex --prefix
./setup --host claude --profile slim --prefix
./setup --host codex --profile slim --prefix
```

`--prefix` exposes namespaced commands such as `goldband-review`. Without it,
hosts that support short names may expose entries such as `review` and `qa`.

`--profile full` is the default and keeps every `goldband-*` workflow visible as
a top-level skill. `--profile slim` keeps only entrypoints such as `goldband` and
`goldband-upgrade` visible, then installs host-specific workflow documents under
`workflows/*.workflow.md` inside the runtime root. The slim profile reduces host
skill discovery pressure, but direct top-level workflow names may not
autocomplete.

## Requirements

- Git
- Bun v1.0+
- Node.js where required by the host or platform
- Playwright Chromium for browser-backed workflows

The root installer verifies Playwright Chromium for workflow installs. In
offline or CI environments, set `GOLDBAND_SKIP_PLAYWRIGHT=1` to skip browser
workflow setup, or set `GOLDBAND_CHROMIUM_PATH` to a compatible Chromium binary.

## Runtime State

Goldband Loop stores local runtime state under `~/.goldband` by default.

Useful config commands:

```bash
goldband-config get telemetry
goldband-config set telemetry off
goldband-config get goldband_language
goldband-config set goldband_language zh-TW
```

Legacy pre-absorption runtime state is a migration input only. New runtime state
should live under `.goldband`.

## Development

From the repository root:

```bash
cd goldband-loop
bun install
bun run build
bun run test:free
```

Before changing installed workflow entries, update [inventory.json](inventory.json)
and run the root inventory gate:

```bash
node scripts/check-goldband-loop-inventory.mjs
```

The root repository also validates installer and integration behavior:

```bash
bash scripts/test-workflow-integration.sh
node scripts/test-windows-platform-integration.mjs
bash scripts/verify-decision-guidance.sh
```

## Documentation

| Doc | What it covers |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Goldband Loop internals and runtime structure |
| [BROWSER.md](BROWSER.md) | Browser command reference |
| [docs/skills.md](docs/skills.md) | Workflow skill catalog |
| [docs/domain-skills.md](docs/domain-skills.md) | Domain skill packaging |
| [docs/tutorial-document-generate.md](docs/tutorial-document-generate.md) | Documentation-generation tutorial |
| [USING_GBRAIN_WITH_GOLDBAND.md](USING_GBRAIN_WITH_GOLDBAND.md) | GBrain integration |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Runtime development workflow |
| [CHANGELOG.md](CHANGELOG.md) | Runtime history |

## Privacy And Telemetry

Telemetry is opt-in. When enabled, Goldband Loop sends usage metadata such as
skill name, duration, success or failure, version, and OS. It does not send
source code, prompts, file contents, repository names, branch names, or arbitrary
user artifacts.

Local analytics are available without remote telemetry:

```bash
goldband-analytics
```

Disable remote telemetry:

```bash
goldband-config set telemetry off
```

## Troubleshooting

Check install status from the root repository:

```bash
./install.sh status
```

Reinstall the runtime:

```bash
./install.sh workflow
./install.sh workflow-codex
./install.sh workflow-slim
./install.sh workflow-codex-slim
```

Rebuild browser tooling:

```bash
cd goldband-loop
bun run build
```

Run the runtime test suite:

```bash
cd goldband-loop
bun run test:free
```
