---
name: implementation-contracts
description: |
  Use before production code changes that define or change contracts: required
  configuration, required data, states, permissions, external side effects,
  paid actions, shared workflow constants, or generic workflow behavior. Keeps
  contract failures explicit, avoids unsafe best-effort behavior, and prevents
  fake generic implementations.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
---

# Implementation Contracts

Hard rules for production contract changes. Follow stricter repo rules when present.

## When to Use

- Before changing required configuration, credentials, permissions, states, or shared constants
- Before adding external side effects such as sending messages, spending money, mutating third-party state, or exposing sensitive data
- Before generalizing a workflow that may hide a platform-specific or customer-specific contract
- When missing data, permissions, or runtime state could otherwise be guessed or silently downgraded

## Pre-Implementation Proportionality

Before adding or expanding a permanent permission, state, workflow, gate,
artifact, lineage, external side effect, or generic mechanism:

- Name the current requirement, root-cause class, or required safety boundary.
- Name the smallest sufficient alternative and its permanent operational or
  maintenance cost.
- If choosing a heavier mechanism, cite current evidence for the named
  requirement, reachable failure path, boundary invariant, or measured
  constraint the smaller option cannot cover.
- Reject changes that impose permanent work on unrelated normal operations or
  create a second authority, state owner, or decision path without that
  evidence.

Do not trade away native approval, authorization, destructive-action, data
safety, or external-side-effect boundaries for simplicity. Smallest sufficient
must still fix the failure class at its authoritative owner; it does not permit
a symptom patch, fallback, special case, or fake generic layer. Routine coding
turns do not need a proportionality report when no permanent mechanism is being
added or expanded.

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

## Completion Check

Before considering the contract change safe, confirm:

- Required inputs, permissions, states, and side effects are named explicitly.
- Missing or invalid contract data produces a clear blocked or failed state.
- External side effects require explicit authorization and durable result state where applicable.
- Generic workflow behavior is backed by a real shared contract, not one hardcoded case.
