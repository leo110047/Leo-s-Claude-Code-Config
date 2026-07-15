<!-- AUTO-GENERATED from goldband.manifest.json. Do not edit. -->
# $goldband context restore

## Goal

Restore saved working context.

## Relevant context

- Use current git state and the newest relevant saved artifacts for this repository and branch.

## Hard boundaries

- Do not fabricate missing history or treat stale artifacts as current evidence.
- Do not modify the project while restoring context.

## Verification

- Identify the artifact used, distinguish saved context from current state, and state the next actionable step.
