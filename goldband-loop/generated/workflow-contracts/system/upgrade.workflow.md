<!-- AUTO-GENERATED from goldband.manifest.json. Do not edit. -->
# $goldband system upgrade

## Goal

Upgrade Goldband.

## Relevant context

- Inspect both repository source and the installed Goldband runtime when the distinction affects the result.

## Hard boundaries

- Do not upgrade, reinstall, or mutate shared configuration without explicit authorization.

## Verification

- Read back the installed state and run the narrowest relevant health, syntax, or installation check.

## Runtime contract

Modes and required inputs:

- `preflight`: `phase`
- `readback`: `phase`, `preflightId`, `oldVersion`, `newVersion`, `setupVerified`

Outputs: `upgrade-preflight`, `installed-version`, `installed-head`, `setup-status`.

Side effects:

- `git-fast-forward`: `native-host-approval`
- `installer-execution`: `native-host-approval`
