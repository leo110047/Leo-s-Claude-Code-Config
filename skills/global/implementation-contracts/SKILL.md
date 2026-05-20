---
name: implementation-contracts
description: |
  Use before production code changes that define or change contracts: required
  configuration, required data, states, permissions, external side effects,
  paid actions, shared workflow constants, or generic workflow behavior. Keeps
  contract failures explicit, avoids unsafe best-effort behavior, and prevents
  fake generic implementations.
---

# Implementation Contracts

Hard rules for production contract changes. Follow stricter repo rules when present.

## Broken Contracts Must Fail Clearly

- Missing config, credentials, permissions, required data, or invalid state must become a clear error, blocked state, or failed state.
- Do not guess missing data.
- Do not downgrade, fallback, or continue unless the degraded path is explicitly part of the product contract.

## No Best-Effort External Side Effects

- Do not best-effort actions that spend money, send messages, mutate third-party state, or expose sensitive data.
- These actions need explicit authorization, clear result state, and durable record when applicable.

## Keep It Small

- Do not add useless checks, branches, flags, fallback paths, states, or UI controls.
- Every new condition must map to a real failure mode or domain rule.
- If one owner layer can solve it, do not patch every layer.

## Avoid Fake Generality

- Do not hardcode one case inside a generic workflow.
- Do not scatter magic strings for statuses, costs, capabilities, or protocol values.
