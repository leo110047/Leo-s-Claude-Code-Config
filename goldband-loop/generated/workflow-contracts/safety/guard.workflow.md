<!-- AUTO-GENERATED from goldband.manifest.json. Do not edit. -->
# $goldband safety guard

## Goal

Enable workflow-local safety rails.

## Relevant context

- Inspect the current safety state and the exact scope the user wants protected or released.

## Hard boundaries

- Change only the requested safety boundary. Never silently widen permissions or edit scope.

## Verification

- Read back the effective safety state and report the scope now allowed or blocked.
