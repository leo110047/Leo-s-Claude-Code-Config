<!-- AUTO-GENERATED from goldband.manifest.json. Do not edit. -->
# $goldband release report

## Goal

Produce a landing report.

## Relevant context

- Inspect the current git state, required checks, release target, deployment path, and rollback signal.

## Hard boundaries

- Require explicit approval before merge, deploy, publish, or any other outward-facing or irreversible action.

## Verification

- Verify the resulting commit, remote, deployment, and user-visible health at the layers the action changed.
