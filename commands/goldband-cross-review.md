---
description: Arm and run the Claude/Codex cross-review gate for the current session.
---

# Goldband Cross Review

Use this command when a task must be reviewed by the other host family before the implementer can finish.

User-facing syntax:

```text
/goldband-cross-review <implementation-plan-path> [codex|claude] [--reviewer codex|claude] [--model <model>]
```

- The path argument is the implementation plan or handoff file to bind to the gate.
- If reviewer is omitted, use the opposite host family from the current implementer.
- If `--model` is omitted, use the reviewer CLI's default model.
- `codex` or `claude` may be supplied as a bare reviewer shortcut after the path, or as `--reviewer`.

Programmatic entrypoint:

```bash
goldband-loop/bin/goldband-cross-review start --plan <path> [--reviewer <codex|claude>] [--model <model>]
goldband-loop/bin/goldband-cross-review run [--model <model>]
goldband-loop/bin/goldband-cross-review respond --session-id <id> --finding-id <id> --response fixed|rebutted|ask-human --summary <text>
goldband-loop/bin/goldband-cross-review done --session-id <id>
goldband-loop/bin/goldband-cross-review override --session-id <id> --reason <reason>
```

The Stop hook checks the session contract, plan marker, reviewer artifact, and current review-scope hash. It does not run an LLM inside the hook.

Implementer responses are written to the cross-review response log and included in the next reviewer prompt. If review escalates or reaches max rounds, the runtime writes a human-arbitration summary path into the active contract and Stop message. Cross-review arm, round, response, escalation, override, and done events are recorded in usage telemetry.

Default review mode is `real`; it invokes the configured reviewer CLI. `--review-mode mock` is only for CI and local contract tests, and mock artifacts are not accepted by the Stop gate as production approval evidence.
