# Goldband Cross-Review Rubric

## Blocking Rules

- `correctness.contract`: The implementation violates an explicit requirement, schema, gate, or source-of-truth contract.
- `security.boundary`: The implementation weakens authorization, secret handling, sandboxing, command safety, or trust-boundary enforcement.
- `data.loss`: The implementation can drop, corrupt, overwrite, or hide user data or required evidence.
- `regression.clear`: The diff introduces a clear regression in existing behavior covered by current files, tests, docs, or workflow contracts.
- `verification.false-claim`: The implementation claims enforcement, parity, or completion that current evidence does not prove.

## Severity Matrix

Use the lowest severity that matches the evidence. A finding is blocking only
when it is `CRITICAL` or `HIGH`, uses one blocking `ruleId`, has a concrete
`failureScenario`, and has `status: "open"`.

Use `CRITICAL` only when at least one of these is true:

- The gate can approve work that violates an explicit contract, schema, source
  of truth, or approval boundary.
- The change can delete, corrupt, overwrite, or hide user data or required
  review/audit evidence without an explicit user-approved path.
- The change weakens authorization, sandboxing, secret handling, command safety,
  or trust-boundary enforcement so protected data can be exposed or protected
  commands can run.
- The change can perform destructive, paid, external, or otherwise
  outward-facing side effects without the required gate or permission.

Use `HIGH` only when at least one of these is true and the issue does not meet
the `CRITICAL` threshold:

- A documented or normal workflow for a real user or maintainer fails, blocks
  completion, or returns the wrong result.
- Existing tested, documented, or contract-covered behavior clearly regresses
  and there is no workaround within the same workflow.
- Required verification, readback, install, runtime, or parity evidence is
  missing or false in a way that can make maintainers trust an unproven result.
- A security, secret-handling, sandboxing, command-safety, or trust-boundary
  issue exists but is limited in blast radius and does not expose protected data,
  run protected commands, or bypass a required approval boundary.

Use `MEDIUM` when the issue is real and should be fixed, but it does not break a
normal workflow, violate a contract, weaken a protected boundary, or make the
gate trust false completion evidence.

Use `LOW` for wording, naming, organization, minor maintainability, minor
performance, or documentation follow-up that does not affect behavior or gate
correctness.

If the supplied bundle does not contain enough evidence to choose a severity,
return `ESCALATE` instead of inventing a blocking finding.

## Advisory Rules

- `style.naming`: Naming, wording, or structure could be clearer but does not change behavior.
- `maintainability.minor`: The code could be easier to read or consolidate, but the contract still holds.
- `performance.minor`: The implementation has small avoidable overhead that does not affect hook safety or workflow viability.
- `docs.followup`: Documentation could be expanded, but the executable gate remains correct.

MEDIUM and LOW findings are advisory. They must not block the marker.
Return advisory findings in the findings array; the runtime records them without
blocking the marker.
