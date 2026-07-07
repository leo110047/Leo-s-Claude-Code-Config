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
npm run test:hook-router
npm run test:hook-router:coverage
npm run test:eval-budget-cap
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

When the global hook is active, goldband runs first. After the goldband
pre-commit or commit-msg gate passes or soft-skips, it looks for an executable
project hook in the repo's default git hook directory:

- `.git/hooks/pre-commit`
- `.git/hooks/commit-msg`

If that project hook exists, goldband runs it next. If it does not exist, the
hook chain ends without requiring any project configuration. There is no order
setting; goldband-first is the default contract.

This repository also has a project style gate script:

```bash
node scripts/check-goldband-project-style-gate.mjs --staged
```

It selects fast goldband-specific checks by staged path: selector parity,
plugin distribution artifacts, hook script references, Codex portability, and
style-gate self-tests. `./install.sh style-gate` installs a thin
`.git/hooks/pre-commit` shim for this checkout; the global goldband hook will
invoke that project hook after the global gate passes.

A repo can opt out permanently by adding `.goldband-no-style-gate`, or
temporarily with:

```bash
GOLDBAND_STYLE_GATE=0 git commit
```

Temporary bypasses print a warning and write a local log under
`${XDG_STATE_HOME:-$HOME/.local/state}/goldband/style-gate-bypass.log`.

If a repo uses Husky or another local `core.hooksPath`, git uses the local value
instead of the global goldband hook. That is expected; in that setup, the
project hook owns the chain and must invoke goldband explicitly if it wants both
checks.

## Plugin and Installer Distribution

Claude Code core distribution uses the local plugin marketplace:

```bash
claude plugin marketplace add ./
claude plugin install goldband@goldband --scope user
claude plugin list --json
```

Before releasing plugin changes:

```bash
node scripts/sync-plugin-assets.mjs --check
npm run test:plugin-distribution
claude plugin validate plugin-assets/claude-code-plugin
```

The sync script generates `plugin-assets/claude-code-plugin/`,
`.claude-plugin/marketplace.json`, and
`docs/reports/plugin-expected-assets.json` from the source `commands/`,
`rules/`, `hooks/`, and `skills/global/` directories. Do not hand-edit generated
plugin files.

CI installs Claude Code with `npm install -g @anthropic-ai/claude-code` and runs
the full `npm run test:plugin-distribution` gate. Local contributors should run
the same command before committing plugin-affecting changes; the `--skip-cli`
mode is only a structural/runtime-smoke fallback and does not validate Claude
plugin manifest schema or installation behavior.

Uninstall paths are intentionally separate:

```bash
claude plugin uninstall goldband@goldband
./install.sh uninstall
```

`./install.sh status` detects when the plugin and installer-managed Claude
assets both exist. Duplicate `commands`, `rules`, `hooks`, or `skills` are not a
green state; status reports active sources, duplicate names, remediation, and
exits non-zero.

goldband's active installer path is the POSIX installer:

```bash
./install.sh all-tools
./install.sh all-with-workflow
./install.sh status
./install.sh uninstall
```

On Windows, use Git Bash or WSL. Native PowerShell install, status, uninstall,
and self-update wrappers are retired. If an older install left
`~/.claude/bin/goldband-self-update.ps1`,
`~/.claude/shell/goldband-launchers.ps1`, or
`~/.claude/.goldband-windows-state.json`, remove those stale files manually.

`./install.sh codex-requirements` manages the POSIX system path
`/etc/codex/requirements.toml`. Native Windows managed requirements must be
installed by an administrator or managed policy at
`%ProgramData%\OpenAI\Codex\requirements.toml`; goldband does not stage
`~/.codex/requirements.toml` as a Windows enforcement path.

## Goldband Telemetry

Goldband telemetry is local-only. It writes JSONL files on this machine and does
not upload to an external service.

Usage events:

```bash
node -e 'const t = require("./hooks/scripts/lib/hook-router/usage-telemetry"); console.log(t.getUsageFile())'
```

Metrics events:

```bash
node -e 'const m = require("./hooks/scripts/lib/hook-router/metrics"); console.log(m.getMetricsFile())'
```

Path resolution order:

1. `CLAUDE_PLUGIN_DATA/<namespace>` when Claude exposes stable plugin data.
2. `GOLDBAND_DATA_DIR/<namespace>` when explicitly configured.
3. `${XDG_DATA_HOME}/goldband/<namespace>` when `XDG_DATA_HOME` is set.
4. `~/.local/share/goldband/<namespace>`.
5. System temp only if the durable paths cannot be created.

Default files are `hook-router/usage-events.jsonl` and
`hook-router/metrics.jsonl` under that resolved data root. Usage telemetry is
enabled by default and can be disabled with
`GOLDBAND_USAGE_TELEMETRY_ENABLED=0`. Hook metrics are enabled by default and
can be disabled with `HOOK_ROUTER_METRICS_ENABLED=0`.

Weekly usage and hook report:

```bash
node hooks/scripts/tools/report-usage-summary.js --days 7
node hooks/scripts/tools/report-usage-summary.js --days 7 --json
```

The human report answers, in the first screen, which `goldband-*` workflow
entries were used and how often, separated into `confirmed` and `inferred`
signals, plus hook deny and advisory counts. `confirmed` means a hook payload
explicitly reported a `Skill` tool invocation with a `goldband-*` skill name.
`inferred` is used for slash-command prompts and Bash wrapper commands such as
`goldband-review`; do not treat inferred signals as real workflow completion.
Future keep/delete decisions should use confirmed workflow counts as the primary
signal. Inferred workflow signals and hook advisories are secondary triage data
and can be noisy.

Weekly telemetry mining:

```bash
node scripts/mine-telemetry.mjs summary --days 7
node scripts/mine-telemetry.mjs classify --days 7
node scripts/mine-telemetry.mjs extract-fixtures --days 7 --out-dir /tmp/goldband-telemetry-review
node scripts/mine-telemetry.mjs extract-evals --days 7 --out-dir /tmp/goldband-telemetry-review
```

The miner never rewrites source telemetry. It reads the usage JSONL base file
plus rotated siblings, and it reads workflow evidence from
`${GOLDBAND_HOME:-$HOME/.goldband}/workflow-runs` unless
`--workflow-runs-dir` is supplied. `extract-fixtures` runs candidate replay
checks with `GOLDBAND_HOME`, `GOLDBAND_DATA_DIR`, and `CLAUDE_PLUGIN_DATA`
pointed at a temp sandbox so hook marker files do not land in the real state
root. Replay fixture and eval outputs are review candidates only; do not append
them to `hooks/fixtures/router/replay-fixtures.json` or a formal eval dataset
until a human has reviewed the sanitized content.

OTLP trace export is opt-in and offline-first. JSONL remains the source of
truth; the exporter only reads the usage file and sends a derived traces payload
when explicitly run:

```bash
node scripts/export-telemetry-otlp.mjs --dry-run
node scripts/export-telemetry-otlp.mjs --endpoint http://localhost:4318
```

The exporter supports `--usage-file`, `--cursor-file`, `--dry-run`, and
`--limit`. `--since` is dry-run only because formal exports advance a cursor. See
[docs/observability.md](docs/observability.md) for the local Jaeger demo and
[docs/telemetry-schema.md](docs/telemetry-schema.md) for the v1 schema.

## Regression Gates and Failure Taxonomy

Hook policy regressions are tracked through the required/free replay gate:

```bash
npm run test:hook-router
npm run test:telemetry
npm run test:hook-router:coverage
npm run test:eval-budget-cap
```

CI runs these commands on every push and pull request. The replay dataset is
`hooks/fixtures/router/replay-fixtures.json`; the coverage checker reads that
dataset plus the live hook policy modules so missing secret-pattern,
pretool-policy, careful-mode, or freeze-mode cases fail mechanically.

Paid Goldband Loop evals are opt-in only through
`.github/workflows/goldband-loop-paid-evals.yml`. They require maintainer budget
confirmation and `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and `GEMINI_API_KEY`
GitHub Actions secrets. If either budget or secrets are missing, the workflow
must report skipped and must not count as PR coverage.

Current hook discovery boundary:

- Claude installed hooks can observe `hook_event_name`, `tool_name`,
  `tool_input`, `tool_response`, `error`, `prompt`, `session_id`, and lifecycle
  fields exposed to the configured hook phase. Claude `UserPromptSubmit` runs
  `skill-activation-suggestions.js`; tool phases run the unified router.
- Codex installed hooks can observe the same tested fields used by
  `codex/hooks/hook-router.js`: `hook_event_name`, `tool_name`, `tool_input`,
  `tool_response`, `prompt`, `last_assistant_message`, and `session_id` when the
  runtime provides it.
- Both hosts record confirmed workflow entry usage only from `PreToolUse`
  payloads where `tool_name` is `Skill` and the tool input contains a
  `goldband-*` name. Prompt signals are recorded as inferred. Bash wrapper
  signals are inferred only when a `goldband-*` executable appears in shell
  command position, not when search, docs, or test output merely mention the
  workflow name.
- New usage events are normalized to `goldband.telemetry.v1` with `run_id`,
  `event_id`, and optional `parent_event_id`. Legacy `sessionId` remains present
  for compatibility with existing local summaries.

## MCP Templates

MCP templates live under `mcp/` and are disabled by default. Before documenting a
server as supported, run MCP Inspector and verify that the server starts and
lists the expected tools.
