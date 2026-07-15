---
name: evidence-based-coding
description: |
  Use when making any claim about code, APIs, configs, files, tests, or fixes,
  especially before proposing changes or declaring work complete.

  CRITICAL: verify with actual code, tool output, or tests before you claim anything.
enforced-globally: true
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
---

# Evidence-Based Coding

Make codebase claims only after checking current files, commands, tests, or
logs. This entrypoint stays short because it is frequently loaded; use
`reference/` only when detailed procedures are needed.

## When to Use This Skill

Use before:

- Suggesting a code change.
- Claiming behavior, API shape, config state, file existence, errors, or fixes.
- Declaring work complete.

## Hard Rules

- Read the actual file before describing behavior.
- Treat search results as leads; read matched context before claiming.
- Do not reuse stale test output, logs, screenshots, or prior-agent reports.
- Do not cite unchecked paths, APIs, configs, line numbers, or errors.
- If behavior matters, run the relevant command or test when feasible.
- If verification is impossible, say what is unverified and what would prove it.
- Treat agent reports as claims until independently checked.
- Never weaken, skip, or delete a test, assertion, type, or lint rule just to
  make a check pass.
- Completion claims need fresh evidence from the current turn.

## References

- `reference/completion-verification.md`: completion gate and failure patterns.
- `reference/verification-workflows.md`: workflows for code, API, path, config,
  and bug claims.
- `reference/hallucination-patterns.md`: common false-claim patterns.
- `reference/goal-verification.md`: goal-backward verification.

## Verification Checklist

Before answering or finishing, confirm:

- The files or commands supporting the claim were checked in this turn.
- The verification scope matches the claim's scope.
- Any unverified behavior, skipped test, or local-only result is named plainly.
