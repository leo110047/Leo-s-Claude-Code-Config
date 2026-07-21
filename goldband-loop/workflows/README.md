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
  [--specialists off|auto|all] \
  [--review-host-timeout-seconds <60-1800>] \
  [--review-pass-timeout-seconds <60-1800>] \
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

Interactive Codex and Claude `$goldband review code` invocations must enter this
runtime through `bin/goldband review code --host <codex|claude>`. The launcher
forces real mode and defaults to the whole current worktree when the user does
not name a narrower scope. User-supplied prompt text never proves runtime
ownership. Runtime-owned child prompts use the dedicated non-router
`GOLDBAND_RUNTIME_TASK=review/code` header and do not invoke `$goldband` again.
Launcher or runtime failure is terminal and must not silently fall back to an
untyped manual review.

Review input has a 2 MiB limit. Larger Git diffs fail with an explicit request
to narrow scope instead of a host-specific buffer error. `--diff-file` accepts
only a stable regular file; untracked files are opened without following
symbolic links, checked again after opening, and read from that same descriptor.
The descriptor is checked again after reading, so an in-place write during
collection fails closed instead of producing mixed input.
Scope flags fail before host dispatch when they conflict; `--base --worktree`
is the only combined primary scope, and `--include-untracked` cannot modify a
supplied `--diff-file`. Untracked path discovery is NUL-delimited so filenames
containing tabs, newlines, quotes, or backslashes are not silently omitted.

The launcher probes the evidence root before starting. If the default
`~/.goldband` root is blocked by the caller's filesystem sandbox, review runs
with a private temporary state root and reports that evidence as ephemeral.
An explicitly configured state root still fails closed when it is not writable.
For Codex, the parent session must request host-native sandbox escalation for
the launcher command before execution: the nested `codex exec` CLI must
initialize Codex state and app-server resources outside the parent command
sandbox. This is one parent-session admission, not an approval request from the
non-interactive child reviewer; the child remains `read-only` with approval set
to `never`.
Strict or exhaustive requests add `--specialists all`; ordinary review keeps
the runtime's `auto` specialist selection.

Codex review subprocesses run with `--ask-for-approval never` and a read-only
sandbox. Reviewer prompts prohibit `require_escalated`: when a test or other
command needs writes, the reviewer records that verification as unavailable and
continues from read-only evidence instead of requesting an approval that
`codex exec` cannot service.
They also use `--ignore-user-config`, an empty `mcp_servers` override, and
`--ephemeral`: authentication remains available from `CODEX_HOME`, while user
customizations, external MCP tools, and persistent reviewer sessions do not.

Claude review subprocesses run with `--safe-mode` and only `Read`, `Glob`, and
`Grep`. This disables hooks, plugins, MCP servers, and other executable
customizations. Because safe mode also disables automatic project instructions,
the review prompt requires the child to inspect applicable `AGENTS.md` and
`CLAUDE.md` files explicitly with those read-only tools.

Both host adapters receive the complete review prompt over stdin rather than a
command argument, so the 2 MiB review-input contract does not exceed the host
operating system's `ARG_MAX` limit.

Each real host call has a twelve-minute default timeout. A complete `run-review`
pass is limited to twelve minutes with specialists off, twenty minutes in auto
mode, and thirty minutes only for explicit exhaustive coverage. The timeout
flags override one pass, must remain between 60 and 1800 seconds, and the host
timeout cannot exceed the pass timeout. Evidence telemetry records the resolved
mode and both timeout budgets so latency can be tuned from real runs.
Pass elapsed time uses a monotonic clock; wall-clock changes affect evidence
timestamps but cannot extend the configured deadline.
When an optional `auto` specialist consumes the remaining pass budget, the
runtime preserves the completed core and specialist results plus a non-blocking
coverage diagnostic. Explicit `--specialists all` coverage still fails closed.

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
