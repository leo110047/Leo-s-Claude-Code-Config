<!-- AUTO-GENERATED from goldband.manifest.json. Do not edit. -->
# $goldband plan sync

## Goal

Preview, inspect, or synchronize a Work Map tracker projection.

## Relevant context

- Ground the plan in current repository files, constraints, decisions, and available verification commands.
- Run preview first and preserve its operation digest and ordered pending step IDs.
- For publish, request native host approval for exactly one next pending step, then invoke plan/sync with mode publish-step, the matching digest, and that step ID. Repeat only after readback.

## Hard boundaries

- Plan only. Do not implement product changes unless the user separately authorizes implementation.
- Never treat tracker state as Work Map authority.
- Approval covers exactly one projection step; synthetic approval flags are forbidden.

## Verification

- Make every task executable by naming its artifact, expected result, and proof step; identify unresolved decisions explicitly.
- Verify protected fields, markers, relationships, remote digest, and persisted checkpoint after each outward step.

## Runtime contract

Modes and required inputs:

- `preview`: `mode`, `workId`
- `inspect`: `mode`, `workId`
- `publish-step`: `mode`, `workId`, `operationDigest`, `stepId`

Outputs: `mode`, `workId`, `readback`.

Side effects:

- `tracker-issue-write`: `publish-step-only`
