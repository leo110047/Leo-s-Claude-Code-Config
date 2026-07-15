<!-- AUTO-GENERATED from goldband.manifest.json. Do not edit. -->
# $goldband system health

## Goal

Inspect Goldband health and installation state.

## Relevant context

- Inspect both repository source and the installed Goldband runtime when the distinction affects the result.

## Hard boundaries

- Do not upgrade, reinstall, or mutate shared configuration without explicit authorization.
- Health inspection is read-only unless the user separately requests maintenance.

## Verification

- Read back the installed state and run the narrowest relevant health, syntax, or installation check.
