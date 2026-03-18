# skill-rules.json Reference

`skills/global/skill-rules.json` is a governance document for humans. It is not loaded by Claude Code as executable runtime config.

## What It Is For

- documenting priority rules
- recording conflict-resolution policy
- centralizing anti-hallucination reminders
- describing intended collaboration between skills

## What It Is Not For

- live prompt matching
- live hook dispatch
- automatic file-path or content-based activation

Those runtime behaviors live elsewhere:
- prompt suggestions: `hooks/scripts/lib/skill-activation/activation-rules.js`
- blocking/non-blocking tool policies: `hooks/scripts/lib/hook-router/*`

## Current Top-Level Fields

### `priority_rules`

Human-readable precedence rules such as:
- debugging before review
- performance vs architecture separation
- review defers to debugging when bugs are present

### `conflict_resolution`

Narrative guidance for ambiguous overlaps between skills.

### `anti_hallucination_rules`

Cross-cutting evidence requirements that reinforce `evidence-based-coding`.

### `global_reminders`

Reusable reminders for maintainers about verification discipline.

### `skill_collaboration`

A map of how skills should defer, collaborate, or stay within scope.

### `metadata`

Version and authorship notes for the governance document itself.

## When To Edit `skill-rules.json`

Edit it when you change:
- priority policy
- overlap resolution
- anti-hallucination governance
- collaboration expectations between skills

Do not edit it as a substitute for wiring runtime behavior. If the live system should behave differently, change the actual hook/router code too.
