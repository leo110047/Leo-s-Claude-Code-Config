# Goldband Cross-Review Rubric

## Blocking Rules

- `correctness.contract`: The implementation violates an explicit requirement, schema, gate, or source-of-truth contract.
- `security.boundary`: The implementation weakens authorization, secret handling, sandboxing, command safety, or trust-boundary enforcement.
- `data.loss`: The implementation can drop, corrupt, overwrite, or hide user data or required evidence.
- `regression.clear`: The diff introduces a clear regression in existing behavior covered by current files, tests, docs, or workflow contracts.
- `verification.false-claim`: The implementation claims enforcement, parity, or completion that current evidence does not prove.

Blocking severity requires a concrete failure scenario. CRITICAL means the gate would allow unsafe, destructive, or contract-breaking work. HIGH means a real user or maintainer can hit the failure during normal use.

## Advisory Rules

- `style.naming`: Naming, wording, or structure could be clearer but does not change behavior.
- `maintainability.minor`: The code could be easier to read or consolidate, but the contract still holds.
- `performance.minor`: The implementation has small avoidable overhead that does not affect hook safety or workflow viability.
- `docs.followup`: Documentation could be expanded, but the executable gate remains correct.

MEDIUM and LOW findings are advisory. They must not block the marker.
