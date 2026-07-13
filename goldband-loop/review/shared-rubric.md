# Shared Review Rubric

This is the canonical review standard for normal `/review` and the review
content consumed by `cross-review`. Execution semantics differ:

- `/review` is read-only findings review. It never edits source files and never
  signs a gate.
- `cross-review` uses this standard inside its own gate contract, verdict
  marker, reviewed-sha, rounds, implementer responses, and escalation flow.

## Taxonomy

- `correctness-contract`: feature correctness, state transitions, explicit
  requirements, schemas, permissions, error handling, and data consistency.
- `testing`: missing or weak regression tests, fixtures, old-behavior failure
  proof, and test claims that do not cover the stated risk.
- `security`: auth/authz, secret handling, injection, unsafe IO, supply chain,
  sandboxing, and trust-boundary enforcement.
- `performance`: N+1 behavior, hot paths, query or bundle growth, memory
  pressure, and clear scaling risks.
- `migration-data`: schema changes, migrations, backfills, backwards
  compatibility, rollback, and rollout safety.
- `api-host-parity`: CLI/API contracts, Claude/Codex host parity, installers,
  workflow routing, prompts, hooks, and runtime consistency.
- `maintainability`: duplicated logic, abstraction fit, ownership boundaries,
  naming, and long-term maintenance risk.
- `ux-design`: user-facing layout, accessibility, interaction, copy, and visual
  regressions when the diff touches UI.

## Severity

Use the lowest severity supported by concrete evidence.

- `critical`: explicit contract, approval, safety, data, authorization,
  sandbox, command, paid action, or external side-effect boundary can be
  violated with no safe workaround.
- `high`: a documented or normal workflow fails, a required verification or
  parity claim is false, or a contained security/safety boundary weakens.
- `medium`: real issue that should be fixed, but no normal workflow or protected
  boundary is broken.
- `low`: minor maintainability, naming, docs, or performance follow-up.
- `info`: skipped/degraded coverage, useful context, or an unverified issue that
  is not supported enough to stay high severity.

High or critical findings without concrete evidence must be downgraded to
`info`. Findings that need human judgment because the supplied evidence is
insufficient should be reported as `info` in normal `/review` and as `ESCALATE`
in `cross-review`.

## Finding validity

Every code finding must prove:

- exact `file` and `line`;
- a concrete input or runtime state with a reachable execution path;
- the incorrect result, expected result, and practical impact.

The machine-readable record may also carry category, policy, recommendation,
verification, and specialist metadata. Those fields do not make an unsupported
finding valid. Suppress speculative findings instead of displaying confidence
scores.

`blocking` means "must be fixed before landing" in normal `/review`. It does
not sign or block the session by itself. `cross-review` maps blocking findings
into its own verdict rules.

## Merge Rules

- Deduplicate by file, line, category, and failure scenario.
- Merge duplicate findings by preserving the strongest severity and most
  specific evidence.
- Record every contributing specialist.
- Sort findings by severity, then file, line, and category.
