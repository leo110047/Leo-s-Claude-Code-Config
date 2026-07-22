<!-- AUTO-GENERATED from goldband.manifest.json. Do not edit. -->
# $goldband document generate

## Goal

Audit documentation coverage and prepare documentation artifacts.

## Relevant context

- Use the named source material, audience, output format, and existing document conventions.
- Audit mode requires a unified diff input and emits a deterministic Diataxis coverage artifact.

## Hard boundaries

- Do not invent product facts, citations, or implementation behavior that the sources do not support.
- Do not update a pull request from the workflow runtime; prepare a PR-body section artifact and require native host approval for the outward-facing update.

## Verification

- Render or inspect the final artifact and verify content accuracy, structure, links, and visual layout as applicable.
- Inspect the coverage artifact schema and the prepared PR-body section; if an update was requested, stop at the native approval boundary.

## Runtime contract

Modes and required inputs:

- `audit`: `diffFile`

Outputs: `coverage-artifact`, `pr-body-section-artifact`.

Side effects:

- `pr-body-update`: `native-host-approval`
