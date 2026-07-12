# Semantic Review Criteria

Apply these criteria during code review of executable behavior changes. They
require semantic review and evidence; they are not regex style checks or writer
self-attestation.

## `single-authoritative-truth`

Apply `architecture-boundaries`: identify the authoritative owner and verify
that every projection or facade traces back to it.

## `no-dead-code`

Apply `change-scope`: verify that the change leaves no unreachable,
unconsumed, removed-behavior, commented-out, compatibility-only, or speculative
implementation behind.

## `no-islands`

Apply `architecture-boundaries`: trace every product-required surface through
its route, registration, inventory, or dependency-injection edge to a reachable
owner operation.

## `productize-do-not-patch`

Apply `change-scope`: verify the fix lives at the owning layer and handles the
failure class rather than one observed example or suppressed symptom.

## `preserve-boundaries-and-authority`

Apply `architecture-boundaries` and `security`: verify adapter containment,
provider-neutral shared contracts, and preservation of native permission
authority.

## `runtime-claims-require-runtime-evidence`

Apply `claim-verification`: match each provider, authentication, permission,
interrupt, process, platform, or deployment claim to live evidence at that
boundary.

## `deterministic-before-ai`

Apply `architecture-boundaries`: verify deterministic ownership of known
formats, invariants, and safety decisions, isolation of optional AI failure,
and explicit failure when AI is the core capability.
