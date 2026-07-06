# Telemetry Mining Report - 2026-07-06

Source command:

```bash
node scripts/mine-telemetry.mjs summary --days 30 --json
node scripts/mine-telemetry.mjs classify --days 30 --limit 50
node scripts/mine-telemetry.mjs extract-fixtures --days 30 --limit 10 --out-dir /private/tmp/goldband-telemetry-review-2026-07-06
node scripts/mine-telemetry.mjs extract-evals --days 30 --limit 20 --out-dir /private/tmp/goldband-telemetry-review-2026-07-06
```

## Data Window

- Usage file: `/Users/leo/.local/share/goldband/hook-router/usage-events.jsonl`
- Workflow evidence directory checked: `/Users/leo/.goldband/workflow-runs`
- Usage events: 676
- Workflow evidence events: 0
- Unique runs: 132
- Bad JSONL lines: 0
- First event: `2026-07-03T12:25:12.431Z`
- Last event: `2026-07-06T01:18:03.209Z`
- Workflow evidence status: insufficient sample; no workflow run JSONL files were present.

## Top Deny / Block Rules

| Rule | Action | Count |
| --- | --- | ---: |
| `recursive-force-delete` | deny | 12 |
| `destructive-git-history` | deny | 6 |
| `curl-pipe-shell` | deny | 5 |
| `secret-detector` | deny | 3 |
| `cross-review-plan-missing` | deny | 1 |
| `cross-review-plan-not-found` | deny | 1 |
| `cross-review-plan-not-found` | block | 1 |
| `cross-review-required` | deny | 1 |
| `dev-server-blocker` | deny | 1 |

## Top Workflow Entries

| Workflow | Host | Confidence | Action | Count |
| --- | --- | --- | --- | ---: |
| `goldband-review` | codex | inferred | invoked | 23 |
| `goldband-loop` | codex | inferred | invoked | 15 |
| `goldband-windows` | codex | inferred | invoked | 12 |
| `goldband-cross-review` | codex | inferred | invoked | 7 |
| `goldband-context-restore` | codex | inferred | invoked | 6 |
| `goldband-investigate` | codex | inferred | invoked | 5 |
| `goldband-config` | codex | inferred | invoked | 4 |
| `goldband-review` | claude | confirmed | invoked | 4 |

## Taxonomy Counts

| Category | Count | Interpretation |
| --- | ---: | --- |
| `false-positive-deny` | 14 | Heuristic candidates only; all require human labeling. |
| `true-deny` | 13 | Likely aligned with high-risk rules, still not human-confirmed. |
| `cross-review-rejection` | 4 | Cross-review gate denies or blocks, not false-positive hook denies. |
| `workflow-drift` | 0 | No workflow evidence files were available to classify. |
| `mode-enforcement-block` | 0 | No mode-enforcement blocks in this 30-day sample. |

## Suspected False Positive Candidates

The miner marks these as suspected only because a later non-blocking signal
appeared in the same run near the deny. That is not proof of a false positive.

| Source event | Rule | Tool | Needs human label |
| --- | --- | --- | --- |
| `evt_7524bce0e2ac4b2306fc231f` | `recursive-force-delete` | Bash | yes |
| `evt_1869dd0cdc313c6c79bf7461` | `recursive-force-delete` | Bash | yes |
| `evt_3ba5c7110dadf4ab00c83612` | `recursive-force-delete` | Bash | yes |
| `evt_aa4742991db110b82daecb45` | `dev-server-blocker` | Bash | yes |
| `evt_0a7fd212ca27960c011ad23c` | `recursive-force-delete` | Bash | yes |

## Replay Fixture Candidates

Review output:

```text
/private/tmp/goldband-telemetry-review-2026-07-06/replay-fixture-candidates.json
```

The run produced 10 sanitized replay candidates. Source metadata paths were
rewritten before output, for example `/repo/.local/share/goldband/hook-router/usage-events.jsonl`.
All 10 replay checks matched the expected exit code, deny decision, and any
configured stderr substring. The first two candidates are:

```json
{
  "candidate_id": "fixture_evt_61cca1121eb16b82bd9cbd50",
  "source_event_id": "evt_61cca1121eb16b82bd9cbd50",
  "source_rule": "destructive-git-history",
  "retained_fields": ["hook_event_name", "tool_name", "tool_input.command"],
  "target_router": "codex/hooks/hook-router.js",
  "fixture": {
    "id": "telemetry-candidate-evt_61cca1121eb16b82bd9cbd50",
    "coverage": {
      "category": "codex-high-risk-policy",
      "policy": "destructive-git-history",
      "expectedDecision": "deny",
      "variant": "telemetry-candidate",
      "regressionSource": "telemetry-miner-review-candidate"
    },
    "input": {
      "hook_event_name": "PreToolUse",
      "tool_name": "Bash",
      "tool_input": { "command": "git reset --hard HEAD~1" }
    },
    "expect": { "exitCode": 0, "decision": "deny" }
  },
  "replay_verification": {
    "verified": true,
    "expectedExitCode": 0,
    "exitCode": 0,
    "exitCodeMatches": true,
    "decision": "deny",
    "expectedDecision": "deny",
    "decisionMatches": true,
    "stderrIncludesMatch": true
  }
}
```

```json
{
  "candidate_id": "fixture_evt_38f91bde5b27dc20934b8447",
  "source_event_id": "evt_38f91bde5b27dc20934b8447",
  "source_rule": "recursive-force-delete",
  "retained_fields": ["hook_event_name", "tool_name", "tool_input.command"],
  "target_router": "codex/hooks/hook-router.js",
  "fixture": {
    "id": "telemetry-candidate-evt_38f91bde5b27dc20934b8447",
    "coverage": {
      "category": "codex-high-risk-policy",
      "policy": "recursive-force-delete",
      "expectedDecision": "deny",
      "variant": "telemetry-candidate",
      "regressionSource": "telemetry-miner-review-candidate"
    },
    "input": {
      "hook_event_name": "PreToolUse",
      "tool_name": "Bash",
      "tool_input": { "command": "rm -rf /" }
    },
    "expect": { "exitCode": 0, "decision": "deny" }
  },
  "replay_verification": {
    "verified": true,
    "expectedExitCode": 0,
    "exitCode": 0,
    "exitCodeMatches": true,
    "decision": "deny",
    "expectedDecision": "deny",
    "decisionMatches": true,
    "stderrIncludesMatch": true
  }
}
```

Do not add these to a formal replay dataset without explicit human approval.

## Eval Candidate Output

Review output:

```text
/private/tmp/goldband-telemetry-review-2026-07-06/telemetry-derived-eval-candidates.json
```

The file uses schema
`goldband.telemetry-derived-eval-candidates.v1`, records the source date range,
documents the case schema, and sets `paid_eval_status: "not-run"`. It is not a
benchmark result and no paid eval was executed.

## Observations And Actions

- `recursive-force-delete`, `destructive-git-history`, and `curl-pipe-shell`
  dominate the deny sample. Action: consider first-class Codex high-risk replay
  fixtures if these candidates are approved.
- The false-positive list is only a heuristic. Action: manually inspect the
  anonymized source ids against local session context before tuning rules.
- Workflow drift is `needs-instrumentation` for this sample because no workflow
  evidence files were present under the checked workflow-runs directory.
- Cross-review gate denials are classified as `cross-review-rejection`, not as
  suspected false-positive hook denies. Action: keep these separate from hook
  deny tuning and inspect repeated plan-file failures as workflow UX issues.
