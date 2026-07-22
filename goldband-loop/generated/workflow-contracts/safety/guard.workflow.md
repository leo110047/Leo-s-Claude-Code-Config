<!-- AUTO-GENERATED from goldband.manifest.json. Do not edit. -->
# $goldband safety guard

## Goal

Enable careful-mode for a Claude session.

## Relevant context

- Inspect the current Claude session ID and its existing careful-mode or freeze-mode state.

## Hard boundaries

- Change only the requested session-scoped hook mode. Never report protection as active without owner readback.

## Verification

- Read back the authoritative hook mode state and verify a representative PreToolUse decision when enforcement changed.
