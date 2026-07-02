---
name: systematic-debugging
description: |
  Use when encountering any bug, test failure, build failure, or unexpected
  behavior before proposing fixes.

  Prefer `/goldband-investigate` or the workflow investigate skill for full
  root-cause work. This portable skill only defines the shared debugging
  contract used by both hosts.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
---

# Systematic Debugging

This is a thin shared-policy entrypoint. The full investigation workflow belongs
in `/goldband-investigate` / workflow so Claude and Codex do not carry duplicate
debugging playbooks in portable skills.

## The Iron Law

No fixes without root-cause investigation first.

If you cannot state the observed symptom, reproduction path, and evidence source,
you are not ready to propose a fix.

## Conflict Rules

- Overrides `code-review-skill`, `performance-optimization`, and
  `backend-patterns` when a concrete bug or failing command is present.
- When bugs are found during review or optimization, stop and debug first.
- Resume other skills only after the defect is systematically investigated and
  fixed or explicitly scoped as out of the current change.

## Gotchas

- Do not propose a fix before you can state the observed symptom, reproduction
  path, and evidence source.
- Do not stack multiple small fixes together. One hypothesis, one test, one
  result.
- Do not stop at the first plausible cause; compare against working examples and
  recent changes.
- Do not treat a non-reproducible issue as permission to guess. Gather more
  diagnostics until the pattern sharpens.
- Do not let urgency override root-cause work. Time pressure is when thrashing is
  most expensive.

## Workflow Handoff

Use `/goldband-investigate` when available for multi-component failures,
production incidents, flaky tests, unclear ownership, or work that needs a
written investigation record.

Use this skill directly only for small local failures or when workflow is not
installed.

## Required Sequence

1. Reproduce the issue and capture the exact failure.
2. Gather concrete evidence from errors, logs, diffs, configs, tests, or runtime
   state before proposing a fix.
3. Form one root-cause hypothesis.
4. Apply the healthiest complete fix that addresses that root cause and reduces
   recurrence risk.
5. Verify with the command, test, or runtime path that proves the issue is fixed.

## Evidence Requirements

- Exact failure text or observed behavior.
- Reproduction command or path.
- Evidence for the chosen root cause.
- Fix summary tied to that root cause.
- Verification command and result.
