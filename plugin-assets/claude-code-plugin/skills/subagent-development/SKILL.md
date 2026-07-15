---
name: subagent-development
description: |
  Use when a task can be isolated into a fresh-context subagent, parallelized safely,
  or reviewed in two stages for spec compliance and code quality.

  Best fit for self-contained work, not shared-context debugging.
allowed-tools:
  - Task
  - Read
  - Grep
  - Glob
  - Bash
---

# Subagent Development

Use subagents only when the host surface and current task policy allow
delegation. A subagent is useful when the work is independent, bounded, and can
be specified without relying on hidden conversation context.

## Use When

- The subtask has a clear owner, files, and expected output.
- It can run in parallel without touching shared state or blocking your next
  local step.
- Fresh context is likely to improve focus, review quality, or search breadth.
- The result can be verified from files, commands, or tests after it returns.

## Avoid When

- The task is shared-context debugging, ambiguous architecture, or an active
  incident whose next step depends on the current investigation.
- The subtask would edit the same files as another worker.
- The prompt would need long unstated context to be safe.
- The only reason is habit, not a measurable speed or quality benefit.

## Dispatch Contract

A good subagent prompt includes only the material needed to act:

- Goal: one sentence.
- Scope: exact files, module, or responsibility.
- Context: specific files to read and patterns to follow.
- Deliverable: what to change or report.
- Boundaries: files, side effects, and scope expansions to avoid.
- Verification: commands or evidence expected before reporting completion.

Tell workers they are not alone in the codebase, must not revert others'
changes, and must adapt to concurrent work.

## Review Contract

Do not trust a subagent completion report by itself. Before accepting it:

- Read every changed file or every cited evidence path.
- Map the result back to the original requirements.
- Rerun or inspect the relevant verification.
- Check for unrequested scope expansion.

If the result is incomplete, diagnose what was missing from the prompt before
re-dispatching. Expanded prompt templates live in
`reference/prompt-templates.md`; load them only when drafting a substantial
worker or reviewer prompt.
