# Architecture and Integration Boundaries

## Scope

Apply this rule when code integrates an external provider, SDK, protocol,
process, permission system, evidence store, or local control-plane boundary. It
does not prescribe a directory layout or provider model.

## Baseline Policy

Each domain fact, decision, and capability has one authoritative owner; each
result or decision has one authoritative operation or computation. External
details stop at adapters, shared code consumes provider-neutral contracts, and
authority stays with its owner.

## Required Behavior

### Contracts and authority

- Keep SDK types, generated protocol types, wire parsing, and provider-specific
  branching inside the owning adapter. Shared and public contracts stay
  provider-neutral and do not expose raw provider payloads.
- Runtime-validate shared events and external data at the boundary. Intentional
  schema changes require an explicit compatibility or versioning decision plus
  behavior tests for producers and consumers.
- Keep provider or platform identifiers open unless the domain is truly closed.
  Shared behavior should dispatch by capability and contract, not by a growing
  switch over provider names.
- Adapters may translate approval requests and results but must not become the
  permission authority. Preserve request ID, correlation, actor, allowed
  decisions, and risk metadata.

### Authoritative behavior and wiring

- Presentation layers and facades may transport, format, cache, or project an
  authoritative result, but must not independently re-derive or reconcile the
  same truth. Caches and projections require explicit provenance, invalidation,
  and freshness rules.
- A capability is complete only when every surface required by its product
  contract is wired, registered, reachable, and verified. Service, API, CLI,
  MCP, UI, and other facades call the owner's operation instead of reimplementing
  it. Wiring includes routing, mounting, inventory, and dependency injection;
  an isolated or unreachable implementation is unfinished. Surfaces the
  contract does not require need not exist.

### AI-assisted paths

- Use deterministic logic for known formats, hard invariants, and
  safety-sensitive decisions. Use AI for semantic judgment or ambiguous
  residual cases. AI-discovered patterns become deterministic behavior only
  through a reviewed, versioned change; runtime memory does not redefine the
  contract.
- When AI is an optional enhancement, isolate its failure so the deterministic
  path remains available. When AI is the core capability, fail explicitly
  rather than returning fabricated, stale, or silently downgraded results.
  Degradation is valid only when the product contract defines it.

### Boundary failures

- Every protocol request that requires a response must receive either a valid
  response or an explicit protocol error. Unsupported or invalid requests fail
  closed rather than hanging or continuing with guessed behavior.
- Apply `security.md` at every trust boundary: architecture defines ownership;
  security defines validation, authorization, secrets, and fail-closed behavior.
- Preserve the root failure. Do not relabel terminal errors as successful
  completion or replace them with a secondary missing-evidence error.

## Completion Standard

A change is not complete when it leaks an external implementation into shared
contracts, creates a second source of truth, leaves a required surface unwired,
weakens an owning system's authority, opens a fail-open boundary, or relies on
provider-specific branching that belongs in an adapter.
