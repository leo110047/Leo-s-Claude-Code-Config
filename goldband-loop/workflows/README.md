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
cap, stop conditions, host support, risk level, integration status, entrypoint
type, and evidence policy. `defineWorkflow()` fails when required fields are
missing.

## Runtime CLI

```bash
bun run workflows/run.ts <capability/action> \
  [--loop] [--max-iterations <n>] \
  [--mode mock|real] [--host mock|claude|codex] \
  [--input <file>] [--base <ref>] \
  [--staged|--worktree|--include-untracked|--diff-file <file>]
```

Registered-only workflows are discoverable but not runnable. Compatibility
workflows read their thin contract in mock mode and fail closed in real mode.
Typed workflows may use real host adapters when their contract explicitly
supports it.

The loop controller evaluates structured signals after each iteration and stops
when the target is met, the same blocker repeats, the signal stops improving,
or the registry iteration cap is reached. A CLI cap may lower but never raise
the registry cap.

`review/code` supports typed diff collection, validated findings, specialist
dispatch, and convergence. `qa/app` currently provides a typed mock adapter;
real browser QA remains registered-only until its browser actions and artifacts
are runtime-owned.

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

See `COVERAGE.md` for typed, compatibility, and registered-only status.
