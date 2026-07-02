# Architecture Decision Records

This document captures significant architectural decisions made during
development.

Format: [ADR (Architecture Decision Record)](https://adr.github.io/)

---

## ADR-001: Keep Portable Skills Thin and Defer Full Workflows to workflow

**Date:** 2026-07-02
**Status:** Accepted

### Context

goldband installs policy and workflow assets for both Claude Code and Codex. The
repo already has a clear responsibility boundary: Claude hooks and Codex rules
are host adapters, while portable skills are shared policy. The vendored
`workflow` runtime owns higher-level review, debugging, planning, design, CSO,
QA, benchmark, and skillify workflows.

Several global skills had grown into duplicate workflow manuals or bundled
scaffold/reference packs. That made the same behavior exist in two places and
increased the chance that Claude and Codex drift apart.

### Decision

Keep global portable skills focused on one of these jobs:

- shared policy that should apply across both hosts;
- domain knowledge that workflow does not own;
- thin handoff entrypoints that say when to defer to workflow.

Full workflow playbooks for review, investigation, planning, security review,
frontend design review, QA, benchmarking, and skill creation belong to workflow
entrypoints such as `/goldband-review`, `/goldband-investigate`, `/plan`,
`/goldband-cso`, `/goldband-design-review`, `/goldband-qa`,
`/goldband-benchmark`, and `/goldband-skillify`.

### Assumptions

- `vendor/workflow/` remains the bundled source for high-level workflows and has
  its own independent lifecycle.
- Claude and Codex continue to install the same portable skill inventory where a
  skill is marked as dual-host in `shell/install/skill-catalog.txt`.
- Thin skills are still useful because they provide trigger boundaries and
  shared policy even when workflow is not installed.
- Host-specific enforcement remains in adapters: Claude hooks and Codex
  execpolicy/config.

### Consequences

**Positive:**

- Reduces duplicate long-form process docs in global skills.
- Makes skill activation cheaper and clearer.
- Keeps review/debug/plan/security/design workflow evolution in one runtime.
- Makes Claude/Codex parity easier to audit because portable skills carry policy
  rather than large host-specific playbooks.

**Negative:**

- Users without workflow installed get thinner guidance than before.
- Some historical language-specific review references are removed from the
  portable skill tree.
- Existing docs and hook suggestions must stay aligned with the smaller skill
  inventory.

**Neutral:**

- Domain skills such as `api-design`, `backend-patterns`,
  `database-patterns`, `testing-strategy`, and `performance-optimization` can
  still keep focused references when workflow does not provide equivalent
  domain material.

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|--------------|
| Keep the thick skills and update both copies | Preserves duplicate workflow ownership and makes drift likely. |
| Delete C-category skills completely | Removes useful trigger boundaries and policy for installs that do not include workflow. |
| Move all workflow logic into portable skills | Violates the repo boundary and makes host parity harder because workflow already owns orchestration. |

### Failure Signals

- Users repeatedly need old reference material that workflow does not cover.
- `/goldband-*` workflow entrypoints diverge from portable skill policy.
- Installer profiles or docs mention skills that no longer exist.
- Codex and Claude inventories no longer install equivalent shared policy.

### Revisit Triggers / Exit Criteria

- Revisit if workflow stops being bundled by default.
- Revisit if OpenAI or Anthropic changes skills to support richer native workflow
  composition that replaces the current workflow runtime boundary.
- Revisit if user feedback shows thin skills are too sparse for non-workflow
  installs.
- Roll back by restoring a specific removed reference pack only after deciding
  that workflow should not own that domain.
