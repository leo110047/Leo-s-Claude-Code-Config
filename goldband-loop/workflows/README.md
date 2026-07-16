# Programmatic Workflows

`goldband-loop/workflows/` is the executable workflow runtime. The public
interface and prompt contracts are owned by `../goldband.manifest.json`.

## Ownership

- Manifest: capability/action identity, goal, relevant context, hard boundaries,
  verification, manual routing, and runtime metadata.
- Generated registry: typed projection of manifest runtime fields.
- Runtime: decomposition support, validated steps, convergence, host adapters,
  safety gates, and JSONL evidence.
- Model: task decomposition, tool selection, and adaptation within the contract.

Every registry entry has `contractPath`, target, evaluation signal, iteration
cap, stop conditions, host support, risk level, lifecycle, integration status,
entrypoint type, runtime owner, and evidence policy. `defineWorkflow()` fails
when required fields are missing or a runnable action has no owner.

## Runtime CLI

```bash
bun run workflows/run.ts <capability> <action> \
  [--loop] [--max-iterations <n>] \
  [--mode mock|real] [--host mock|claude|codex] \
  [--input <file>] [--base <ref>] \
  [--staged|--worktree|--include-untracked|--diff-file <file>]
```

Public actions are discoverable. Experimental actions stay in the generated
inventory for engineering tracking, but are excluded from routing and
activation hints and are not runnable. They cannot claim a runtime owner.
Compatibility workflows read their thin contract in mock mode and fail closed
in real mode. Typed workflows may use real owner adapters when their contract
explicitly supports it.

The loop controller evaluates structured signals after each iteration and stops
when the target is met, the same blocker repeats, the signal stops improving,
or the registry iteration cap is reached. A CLI cap may lower but never raise
the registry cap.

`review/code` supports typed diff collection, validated findings, specialist
dispatch, and convergence. `qa/app` currently provides a typed mock adapter;
real browser QA remains unsupported until its checks consume the typed
`browser/session` evidence contract.

## Owner input contracts

Real mode reads structured JSON from `--input`. Required semantic content is
produced by the model; runtime owners validate, gate, persist, and read it back.

| Action | Runtime owner | Real-mode input |
| --- | --- | --- |
| `browser/session` | `browse` | Optional `command` and `args`; only read-only commands are delegated. Mutations use the browser tool's native approval path. |
| `design/consult` | `design-decision-store` | `brief` and `decisions` with typography, color, spacing, layout, and motion. |
| `safety/guard` | `workflow-safety-state` | Optional `scope`. |
| `safety/freeze` / `safety/unfreeze` | `freeze-hook-state` | Optional freeze `scope`; unfreeze reads the same state owner. |
| `context/save` / `context/restore` | `context-checkpoint-store` | Save requires `summary`; restore reads the latest cwd-bound checkpoint and reports freshness. |
| `knowledge/recall` | `goldband-knowledge` | Optional `query`, `domain`, and `limit`. |
| `benchmark/workflow` | `benchmark-evidence-aggregator` | `label`, `metric`, `conditions`, `sourceEvidence`, and at least two numeric `samples`. |
| `system/health` | `goldband-installation` | None; inspection is read-only. |
| `system/upgrade` | `goldband-setup-gate` | Preflight persists an ID and emits command arrays for native host approval. Readback requires the preflight ID, old/new versions, and `setupVerified=true`; runtime never hides `git pull` inside a child process. |
| `ios/qa` | `ios-qa-evidence` | User-visible `checks`; macOS real mode also verifies available simulator inventory. |

## Evidence

Each step appends a JSONL event containing workflow, run id, step, status,
duration, output digest, iteration, signal snapshot, and artifacts. Loop runs
also append a `loop-summary` with the signal trail and stop reason.

```text
${GOLDBAND_HOME:-$HOME/.goldband}/workflow-runs/<workflow>.jsonl
${GOLDBAND_HOME:-$HOME/.goldband}/workflow-runs/artifacts/
```

Untracked diff materialization is a trust boundary. The runtime skips binary,
oversized, non-UTF-8, or secret-like content and records a no-content marker.
Unsupported high-severity findings are downgraded instead of presented as
verified blockers.

## Verification

```bash
node ../scripts/test-workflow-contracts.mjs
bun run typecheck
bun run test:workflows
```

See `COVERAGE.md` for typed, compatibility, experimental, and owner status.
