---
description: Legacy compatibility entrypoint. Prefer /goldband-review for full workflow review.
---

# Code Review

Legacy compatibility entrypoint for code review.

For full review passes, use `/goldband-review`. The portable
`code-review-skill` is now a thin shared-policy entrypoint, and the complete
review workflow belongs to workflow so Claude and Codex do not carry duplicate
review playbooks.

## Arguments

$ARGUMENTS can be:
- (none) — Review the current diff through the workflow review stance
- `--spec` — Include explicit spec/requirements compliance if a spec is
  available
- `--spec <file>` — Read that file as the requirements source before reviewing

---

## Required Behavior

1. Prefer `/goldband-review` when workflow is available.
2. Start findings first, ordered by severity, with concrete file/line evidence.
3. Separate patch-specific findings from repo baseline failures.
4. If a concrete bug, failing command, or unexpected behavior appears, stop the
   review stance and switch to debugging before proposing fixes.
5. Do not edit files or auto-fix from this legacy command.
6. Block on CRITICAL/HIGH issues; otherwise clearly state residual risk and test
   gaps.

## Spec Compliance

When `$ARGUMENTS` includes `--spec`, identify the requirements source:

- If `--spec <file>` is given, read that file.
- If `--spec` alone, look for a nearby plan, PR description, or ask the user.

For each requirement, verify against actual code and report:

```
SPEC COMPLIANCE REVIEW
======================
| # | Requirement | Status | Location | Notes |
|---|-------------|--------|----------|-------|
| 1 | [req text]  | [status] | file:line | [detail] |
```

Block if any requirement is Missing or Incorrect.

## Review Checklist

1. Get changed files: `git diff --name-only HEAD`
2. Read the changed files and relevant production paths.
3. Check security, correctness, maintainability, performance, tests, and
   migration safety.
4. Report findings with severity, file location, evidence, and concrete fix
   direction.
