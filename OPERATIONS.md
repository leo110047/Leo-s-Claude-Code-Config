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

A repo can opt out permanently by adding `.goldband-no-style-gate`, or
temporarily with:

```bash
GOLDBAND_STYLE_GATE=0 git commit
```

Temporary bypasses print a warning and write a local log under
`${XDG_STATE_HOME:-$HOME/.local/state}/goldband/style-gate-bypass.log`.

If a repo uses Husky or another local `core.hooksPath`, git uses the local value
instead of the global goldband hook. That is expected.

## Installer Distribution

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
Phase 2 keep/delete decisions should use confirmed workflow counts as the
primary signal. Inferred workflow signals and hook advisories are secondary
triage data and can be noisy.

## Regression Gates and Failure Taxonomy

Hook policy regressions are tracked through the required/free replay gate:

```bash
npm run test:hook-router
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

See:

- [docs/HOOK_REGRESSION_GATES.md](docs/HOOK_REGRESSION_GATES.md)
- [docs/FAILURE_TAXONOMY.md](docs/FAILURE_TAXONOMY.md)

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

## MCP Templates

MCP templates live under `mcp/` and are disabled by default. Before documenting a
server as supported, run MCP Inspector and verify that the server starts and
lists the expected tools.
