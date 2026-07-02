---
name: code-review-skill
description: |
  Use when reviewing pull requests or code changes for correctness,
  maintainability, security, performance risks, or missing tests.

  Prefer `/goldband-review` or the workflow review skill for full review passes.
  This portable skill only defines shared review policy and output shape.
  Defer to `systematic-debugging` for bugs, failing tests, or unexpected behavior.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
---

# Code Review Skill

This is a thin shared-policy entrypoint. The full review workflow belongs in
`/goldband-review` / workflow so Claude and Codex do not carry a duplicate
review playbook in portable skills.

## Gotchas

- Findings lead. Put blocking correctness, security, data loss, migration, or
  missing-test risks before summaries.
- Do not review from vibes. Read the diff, relevant production path, tests, and
  current config before making claims.
- If a bug, failing test, or unexpected behavior appears, stop the review and use
  `systematic-debugging`; resume review only after the defect is scoped.
- Keep baseline failures separate from regressions introduced by the change under
  review.
- Do not spend review budget on formatter or lint issues that automation already
  enforces.

## Workflow Handoff

Use `/goldband-review` when available for a full staff-engineer review pass,
multi-file diffs, review logs, specialist checks, or release-gate review.

Use this skill directly only when the user asks for a lightweight review or when
workflow is not installed.

## Output Shape

1. Findings first, ordered by severity, each with a concrete file and line when
   available.
2. Open questions or assumptions.
3. Short change summary only after findings.
4. Verification performed and verification not performed.

If there are no findings, say that clearly and still report remaining test gaps
or residual risk.
