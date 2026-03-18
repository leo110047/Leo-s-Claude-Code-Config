# Trigger Types

This repo currently has three real trigger surfaces for skills. Anything beyond these should be documented as future work or implemented with a dedicated hook.

## 1. Native Skill Routing

Claude uses the skill's frontmatter and body to decide when to load it.

### What matters most

- `name`
- `description`
- the first screenful of `SKILL.md`

### Best practice

Write descriptions as trigger guidance, not as human summaries.

Good:

```yaml
description: Use when a task involves bugs, failing tests, crashes, or unexpected behavior and root-cause investigation must happen before proposing fixes.
```

Bad:

```yaml
description: Covers debugging workflows, logging, root causes, and bug fixing.
```

## 2. Prompt-Time Suggestions via `UserPromptSubmit`

This repo has an explicit suggestion layer:

- Hook: `hooks/scripts/hooks/skill-activation-suggestions.js`
- Rules: `hooks/scripts/lib/skill-activation/activation-rules.js`

Each rule can include:
- `keywords`
- `patterns`
- `priority`
- `hint`

Example shape:

```js
{
  skill: 'systematic-debugging',
  priority: 'critical',
  hint: 'Use before proposing fixes for bugs, test failures, or unexpected behavior.',
  keywords: ['bug', 'debug', 'error', 'failing test'],
  patterns: [/\b(stack trace|root cause)\b/i]
}
```

### When to add a suggestion rule

- The skill is broadly useful and often under-triggered
- The prompt surface is easy to recognize with low false-positive risk
- A concise hint materially improves behavior

### When not to add one

- The skill is niche or project-specific
- The matching terms are too generic
- The rule would mostly duplicate native routing without improving outcomes

## 3. Explicit Invocation

The user can always force a skill via:

- `/skill-name`
- direct mention in the prompt

This is still important for low-frequency or high-friction skills such as `careful-mode` and `freeze-mode`.

## What Is Not Generic Runtime Behavior Today

These are not general-purpose, repo-wide skill triggers right now:

- file-path based skill auto-activation
- file-content based skill auto-activation
- actual “skill was used” truth from hook payloads

If you need one of those, implement a dedicated hook or mode and document it explicitly instead of pretending the generic skill system already supports it.
