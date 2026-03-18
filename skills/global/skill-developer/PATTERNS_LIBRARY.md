# Patterns Library

Reusable trigger phrasing and prompt-pattern ideas for this repo's current skill system.

## Description Starters

Use descriptions that answer “when should the model load this skill?”

```yaml
description: Use when a task involves ...
description: Use before changing ...
description: Use after editing ...
description: Use when the user asks for ...
```

## High-Signal Prompt Keywords

### Debugging

```text
bug
error
exception
crash
failing test
regression
root cause
```

### Performance

```text
slow
performance
bottleneck
latency
throughput
bundle size
```

### Skill Development

```text
create skill
skill trigger
progressive disclosure
skill hook
skill scaffold
```

### Config Verification

```text
hooks.json
skill-rules.json
plugin data
verify config
hook replay
```

## Regex Patterns

Use regex when the intent matters more than a single keyword.

```regex
\btest(s)?\b.{0,24}\b(fail|failing|broken|red)\b
\b(design|architect|structure|pattern)\b.{0,24}\b(api|service|backend)\b
\b(hook|skill|plugin|claude code config)\b.{0,24}\b(verify|validation|manifest|router)\b
\b(create|add|scaffold)\b.{0,24}\bskill\b
```

## Conflict Handling Patterns

- If debugging signals exist, suppress code-review suggestions.
- If architecture language dominates without performance language, prefer `backend-patterns`.
- If performance language dominates without architecture language, prefer `performance-optimization`.

Encode these in `activation-rules.js`, not only in prose.
