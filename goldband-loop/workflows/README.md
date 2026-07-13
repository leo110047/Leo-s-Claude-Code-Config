# Programmatic Workflows

`goldband-loop/workflows/` is the programmatic runtime layer for Goldband
Loop workflows. Markdown skills and templates stay as the user-facing entry
points and human instructions. The workflow registry owns the executable
contract metadata: target, evaluation signal, iteration cap, stop conditions,
runtime steps, and evidence policy.

## Source Of Truth

- Entrypoint and human guidance: `*/SKILL.md.tmpl`, generated `SKILL.md`, and
  root commands such as `../commands/plan.md`.
- Installed workflow inventory: `inventory.json`.
- Host generation and support metadata: `hosts/*.ts` and
  `scripts/gen-skill-docs.ts`.
- Usage telemetry: `../hooks/scripts/lib/hook-router/workflow-telemetry.js`.
- Runtime contract and evidence: `workflows/registry.ts` plus this directory.

This avoids a third metadata list. The registry references the existing skill
source path as a runtime package asset and only adds runtime execution fields.

## Registry

`registry.ts` registers every workflow listed in `inventory.json` plus the root
`plan` command. Every entry has:

- `name`
- `sourceTemplate`
- `entrypointType`: `typed`, `compatibility`, or `legacy-thin`
- `integrationStatus`: `integrated` or `registered-only`
- `hostSupport`
- `riskLevel`
- `target`
- `evaluationSignal`
- `iterationCap`
- `stopConditions`
- `evidencePolicy`

`defineWorkflow()` fails when target, evaluation signal, iteration cap, stop
conditions, source template, or host support are missing.

## Runtime CLI

```bash
bun run workflows/run.ts <workflow-name> \
  [--loop] \
  [--max-iterations <n>] \
  [--input <file>] \
  [--base <ref>] \
  [--mode mock|real] \
  [--host mock|claude|codex] \
  [--staged|--worktree|--include-untracked|--diff-file <file>]
```

Default mode is mock unless `--mode real` is passed. Real mode fails unless
`--host claude` or `--host codex` is also provided; invalid modes or hosts fail
at CLI parse time instead of falling back to mock. Registered-only workflows are
visible in the registry but cannot run yet.
Compatibility workflows currently support mock mode only: they read their
legacy prompt source, emit a digest-backed evidence event, and fail closed in
real mode until their typed migration is complete. Real LLM execution is only
enabled for typed runtime steps such as `review/code`.

By default, `workflows/run.ts` uses the single-pass `runWorkflow` entrypoint.
Pass `--loop` to use `runWorkflowLoop` for typed convergence workflows. The
loop controller evaluates structured signals after each iteration and stops
when the target is met, the same blocker repeats, the signal stops improving,
or the effective iteration cap is reached. `--max-iterations <n>` may lower the
registry cap for a run, including real mode budget control, but it cannot raise
the cap above the registry value.

For `review/code`, diff selection is:

- `--diff-file <file>` reads an existing fixture or saved diff.
- `--staged` runs `git diff --staged`.
- `--base <ref>` runs `git diff <ref>...HEAD`.
- `--worktree` runs `git diff HEAD` when the repo has `HEAD`, so both staged
  and unstaged tracked changes are included, and materializes safe untracked
  text files into synthetic new-file diff sections. In an unborn repo with no
  `HEAD`, it combines `git diff --cached` and `git diff`.
- `--include-untracked` adds those safe synthetic new-file sections to other
  diff modes.
- No diff flag runs `git diff`.

`sourceTemplate` paths are resolved relative to the Goldband Loop runtime root,
not the target repository `cwd`. The target `cwd` is only used for diff
collection and relative input files.

Untracked file materialization is a trust boundary for real host execution.
The runtime skips untracked files instead of reading their content when they are
larger than 128 KiB, when the combined untracked payload exceeds 512 KiB, when
the file appears binary or non-UTF-8, or when secret-like content is detected
(`token=...`, API keys, JWTs, private-key blocks, and similar credential
assignments). Skipped files are represented by a no-content marker in the diff
so reviewers see the omission without leaking the file body to `--host codex`
or `--host claude`.

High or critical findings returned without concrete `evidence` are retained in
the report but downgraded to `info` with an `unverified` prefix. This is an
explicit trust policy: the runtime does not present high severity claims unless
the host supplied diff-backed evidence.

For `review/code --loop`, one iteration is the typed review pipeline:
collect diff, run review, parse findings, verify findings, and render the
report. Later iterations receive the previous validated findings in their
iteration context so the review can focus on whether those findings resolved
and whether new issues appeared. The review target predicate is exposed as the
registry stop condition `findings-converged`, which matches when the validated
finding count reaches zero.

For `qa/app --loop`, the current typed adapter is intentionally narrow:
mock mode selects a fixed check list, records schema-validated pass/fail
results, and retries only failed checks on the next iteration. Real browser QA
still uses the markdown `/qa` skill until its browser actions and screenshot
artifacts are migrated into typed runtime steps.

## Evidence

Each step writes one JSONL event:

```json
{
  "runId": "...",
  "workflow": "review/code",
  "step": "collect-diff",
  "startedAt": "2026-07-04T00:00:00.000Z",
  "durationMs": 12,
  "status": "ok",
  "outputDigest": "...",
  "iteration": 1,
  "signalSnapshot": {
    "kind": "review-findings",
    "findingCount": 0,
    "severityCounts": {
      "critical": 0,
      "high": 0,
      "medium": 0,
      "low": 0,
      "info": 0
    }
  },
  "artifacts": []
}
```

Loop runs also write a `loop-summary` event with `iterationCount`,
`stopReason`, `signalTrail`, and `stopHistory`.

Readback path:

```bash
${GOLDBAND_HOME:-${GOLDBAND_STATE_DIR:-${GOLDBAND_STATE_ROOT:-$HOME/.goldband}}}/workflow-runs/<workflow>.jsonl
```

Rendered artifacts are written under:

```bash
${GOLDBAND_HOME:-${GOLDBAND_STATE_DIR:-${GOLDBAND_STATE_ROOT:-$HOME/.goldband}}}/workflow-runs/artifacts/
```

State root precedence is `options.goldbandHome`, `GOLDBAND_HOME`,
`GOLDBAND_STATE_DIR`, `GOLDBAND_STATE_ROOT`, guarded `CLAUDE_PLUGIN_DATA` when
`CLAUDE_PLUGIN_ROOT` identifies Goldband, then `$HOME/.goldband`.

## Host Adapter Verification

Verified on 2026-07-04:

| Host | Local version | Runtime command | Evidence |
| --- | --- | --- | --- |
| Codex | `codex-cli 0.142.5` | `codex exec --sandbox read-only --json --output-schema <schema> -o <file> <prompt>` | local `codex --version` and `codex exec --help`; official docs: https://developers.openai.com/codex/cli/reference and https://developers.openai.com/codex/noninteractive |
| Claude | `2.1.201 (Claude Code)` | `claude -p --output-format json --disable-slash-commands --tools "" --max-budget-usd 0.50 --json-schema <schema> <prompt>` | local `claude --version` and `claude --help`; official docs: https://code.claude.com/docs/en/cli-reference |

Local command excerpts:

```text
$ codex --version
codex-cli 0.142.5

$ codex exec --help
Run Codex non-interactively
Usage: codex exec [OPTIONS] [PROMPT]
       codex exec [OPTIONS] <COMMAND> [ARGS]
  -s, --sandbox <SANDBOX_MODE>
          [possible values: read-only, workspace-write, danger-full-access]
      --output-schema <FILE>
          Path to a JSON Schema file describing the model's final response shape
      --json
          Print events to stdout as JSONL
  -o, --output-last-message <FILE>
          Specifies file where the last message from the agent should be written

$ claude --version
2.1.201 (Claude Code)

$ claude --help
Claude Code - starts an interactive session by default, use -p/--print for non-interactive output
  --json-schema <schema>     JSON Schema for structured output validation...
  --max-budget-usd <amount>  Maximum dollar amount to spend on API calls (only works with --print)
  --output-format <format>   Output format (only works with --print): "text", "json", or "stream-json"
  -p, --print                Print response and exit...
  --tools <tools...>         Specify the list of available tools ... Use "" to disable all tools
```

Discovery note: `scripts/resolvers/codex-helpers.ts` currently contains Codex
skill-generation helpers, not a process execution adapter. The workflow host
adapter reuses its frontmatter parsing helper for prompt labels and keeps all
CLI process calls centralized in `host-adapter.ts`.

## Integrated Workflows

The current core set was chosen from repository fallback guidance because local
`~/.goldband/analytics/skill-usage.jsonl` had no `workflow-entry` usage events
to rank workflows. Fallback sources were root `CLAUDE.md`, `rules/git-workflow.md`,
and `goldband-loop/CLAUDE.md`.

- `review/code`: typed runtime with convergence loop support.
- `investigate/code`: compatibility runtime.
- `qa/app`: typed mock convergence adapter; real browser QA remains markdown-driven.
- `plan`: compatibility runtime.
- `review/security`: compatibility runtime.

See `COVERAGE.md` for the full integrated and pending list.
