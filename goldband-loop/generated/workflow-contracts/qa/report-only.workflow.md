<!-- AUTO-GENERATED from goldband.manifest.json. Do not edit. -->
# $goldband qa report-only

## Goal

Report QA findings without fixing.

## Relevant context

- Use the requested environment, user flow, expected behavior, and active-host browser state when browser work is needed.

## Hard boundaries

- Do not change the product unless the user explicitly asked to fix verified defects.
- Do not modify files, application state, or deployment state while reporting findings.

## Verification

- Record direct pass/fail evidence for each tested behavior and distinguish tested, blocked, and untested scope.
