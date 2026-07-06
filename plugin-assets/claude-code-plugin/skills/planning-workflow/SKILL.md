---
name: planning-workflow
description: |
  Use when turning a request into an implementation plan, especially before
  multi-file changes, refactors, or work that needs explicit phases and
  verification.

  Prefer `/plan` or workflow planning skills for full implementation plans. This
  portable skill only defines shared planning policy and decision-quality
  requirements.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
---

# Planning Workflow

This is a thin shared-policy entrypoint. Full planning belongs in `/plan` /
workflow so Claude and Codex do not carry duplicate planning playbooks in
portable skills.

## Gotchas

- Do not hide multiple actions inside one task because they touch the same
  feature.
- Do not plan implementation steps before reading current files and constraints.
- Do not use vague placeholders like "update config" or "fix the bug"; name the
  file or evidence still needed.
- Do not push verification to the end only. Every task needs its own proof.
- Do not skip the decision-quality check when the plan recommends an architecture
  or direction.

## Workflow Handoff

Use `/plan`, `/goldband-plan-eng-review`, or workflow planning skills when
available for multi-file implementation, cross-host policy work, refactors,
release plans, or work that needs reviewable phases.

Use this skill directly only for small plans or when workflow is not installed.

## Decision-Quality Block

Include this block when the plan recommends an approach, architecture direction,
tooling direction, refactoring strategy, or project-health priority:

- Recommendation.
- Why it fits now.
- Assumptions that must hold.
- Main failure modes.
- Early warning signals.
- Best alternative and when it becomes better.
- Unknowns still needing verification.

## Task Requirements

Each task should name:

- File path or artifact involved.
- One concrete action.
- Expected output or observable result.
- Verification command or inspection step.

If a task hides multiple actions, split it. If a path or command is not verified,
say so before presenting the plan as executable.
