# Deep CEO Review Rubric

Use this reference only when the compact CEO review skill says to load it. It is
not a mandatory checklist for every plan.

## Decision Instincts

Use these as lenses, not as sections to recite:

1. **Reversibility:** Separate one-way doors from two-way doors. Move faster on
   reversible choices.
2. **Inversion:** Ask what would make the plan fail, then check whether the plan
   handles those conditions.
3. **Subtraction:** Ask what can be removed while preserving the user outcome.
4. **Leverage:** Prefer reuse, deletion, and focused interfaces over new
   orchestration.
5. **Proxy skepticism:** Confirm metrics and deliverables still serve the user,
   not the process.
6. **Narrative clarity:** Make the reason for hard tradeoffs legible.
7. **Time horizon:** Check whether the plan makes the next six months easier or
   creates debt the team will immediately feel.
8. **Trust:** Every UX, data, and operational decision should either build trust
   or be removed.

## Scope Challenge

Use these questions when the premise is uncertain:

- Is this the right problem to solve?
- What user or business outcome is the plan actually optimizing?
- What happens if nothing is built?
- Which existing implementation already solves part of this?
- What is the minimal viable approach?
- What is the healthier long-term approach?
- What evidence would justify choosing the heavier approach now?

## Review Lenses

Pick only the lenses that match the plan's risk.

### Architecture

Check ownership boundaries, data flow, state machines, coupling, scaling,
rollback posture, and whether a simpler architecture can satisfy the same
outcome.

### Failure Modes

For important new paths, name specific failures: missing input, empty input,
bad type, timeout, conflict, stale state, upstream error, permission denial, and
partial write. Identify what catches each one and what the user sees.

### Security

Use when the plan touches auth, secrets, customer data, external input, network
boundaries, process execution, browser automation, or paid/irreversible actions.
Check authorization, validation, secret handling, auditability, and injection
paths.

### Data And Interaction Edges

Use for UI, API, workflow, queue, or state changes. Check refresh, retry,
double-submit, back navigation, slow network, stale data, empty state, and
concurrent updates.

### Tests

Identify the few tests that prove the highest-risk behavior. Prefer executable
checks over long manual matrices. Use broad matrices only when the risk is
cross-platform, cross-provider, or contract-heavy.

### Observability

Require metrics, logs, alerts, dashboards, or runbooks only when production
failure would otherwise be hard to detect or diagnose.

### Data Storage

Use for migrations, new tables, indexes, caches, durable queues, or persistent
state. Check data integrity, backfill, rollback, and query shape.

### API Or Contract

Use when request/response shapes, public CLI flags, event schemas, permissions,
or generated surfaces change. Check versioning, compatibility, and validation.

### Performance

Use when the plan adds heavy computation, network calls, bundle weight, polling,
large files, hot paths, or fan-out. Ask what breaks at 10x and whether current
evidence makes that scale relevant.

### UX

Use when the user experience changes. Check information hierarchy, loading,
empty, error, disabled, and responsive states. Avoid adding UI elements that do
not earn their space.

## Diagram Guidance

Diagrams are useful when they clarify a relationship that prose would obscure.
They are not mandatory for every non-trivial flow.

Use a diagram for:

- Multi-system data flow
- State machines
- Permission or trust boundaries
- Retry/rollback paths
- User journeys with branching states

Skip a diagram when a short ordered list is clearer.
