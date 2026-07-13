# Read-Only Review Checklist

## Instructions

Review the diff for concrete issues. Cite `file:line` when available. Flag only
real problems with evidence. Do not edit files, apply patches, commit, push,
or run repair workflows.

Use `shared-rubric.md` as the canonical taxonomy, severity standard, finding
shape, and merge rule source. This checklist gives the core review pass; the
specialist passes cover the same taxonomy from narrower responsibilities.

## Finding validity gate

Only report a finding when all three are present:

- an exact `file:line`;
- a concrete input or runtime state and a reachable execution path;
- the incorrect result, expected result, and practical impact.

A suspicious pattern, style preference, generic best practice, or unsupported
test gap is not a finding.

## Output Format

```
[P1] Short problem title — path/to/file.ts:42

When <input/state>, execution reaches <path> and produces <actual> instead of
<expected>, causing <impact>.

Fix: <one-sentence healthy fix>
```

If no issues survive the validity gate, output `No findings.` and briefly name
the high-risk paths that were actually traced.

Always include:

`Read-only review: no files were modified.`

## Core Review Categories

### Problem-Fix Correctness

- For bugfixes, trace the original failure mode through the changed code path.
  Flag fixes that silence symptoms, change unreachable code, or leave the
  failing input/state unhandled.
- For feature or workflow changes, verify the implementation is wired into the
  runtime path users invoke. A file or config existing on disk is not enough.
- For contract changes, verify producers and consumers agree on required
  fields, states, permissions, side effects, and error behavior.
- For test claims, verify the test would fail against the old behavior and
  exercises the stated requirement.

### SQL & Data Safety

- String interpolation in SQL instead of parameterized queries.
- Read-check-write races without atomic `WHERE` updates, uniqueness
  constraints, or duplicate-key handling.
- Bypassing model validations for direct DB writes.
- N+1 queries from missing eager loading.

### Race Conditions & Concurrency

- Find-or-create without a unique index or duplicate handling.
- Status transitions that do not atomically check the old state.
- Shared mutable state without ownership, locking, idempotency, or replay
  behavior.

### Trust Boundaries

- LLM-generated values written to DB or sent externally without validation.
- Structured tool output accepted without type/shape checks.
- LLM-generated URLs fetched without an allowlist or internal-network guard.
- User-controlled HTML rendered unsafely.
- Shell commands using interpolation or `shell=True` with untrusted input.

### Enum & Value Completeness

When the diff introduces a new enum value, status string, tier name, or type
constant, trace sibling values through every consumer. Read matches, do not stop
at grep output.

### API, Host, Workflow, And Installer Parity

- Prompt/tool capability text must match runtime behavior.
- Claude and Codex paths must name capability gaps instead of pretending parity.
- Installer, README, generated skills, and inventory docs must reflect shared
  workflow contract changes before claiming parity.
- Cross-review must not be routed to normal `/review`.

### Completeness And Verification

- Missing negative-path or regression tests only when a concrete behavioral
  defect has already been demonstrated.
- Claims of enforcement, readback, install, runtime, or parity evidence that are
  not proven by current files or commands.
- Partial implementations where finishing the explicit contract is modest.

### Architecture And Maintainability

- New abstractions that serve one call site without reducing real complexity.
- Logic in the wrong layer: UI enforcing server rules, hooks hiding core
  runtime behavior, or installers owning policy that belongs in skills/rules.
- Fallbacks that mask broken contracts.
- Duplicated sources of truth without a generator, test, or readback.

## Suppressions

Do not flag:

- Harmless redundancy that improves readability.
- Comments requested only to explain unstable thresholds.
- Assertions that already cover the behavior.
- Consistency-only changes that do not affect behavior or contracts.
- Regex edge cases impossible under validated input constraints.
- Tests that cover multiple guards when the combined behavior is meaningful.
- Findings already fixed in the same diff.
