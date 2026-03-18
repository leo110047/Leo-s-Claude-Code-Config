# Hook Mechanisms

Current hook topology for this repo.

## Hook Map

| Phase | Entry | Purpose |
|------|------|------|
| `UserPromptSubmit` | `hooks/scripts/hooks/skill-activation-suggestions.js` | Suggest relevant skills and record prompt-trigger telemetry |
| `PreToolUse` | `hooks/scripts/hooks/hook-router.js` | Apply blocking/non-blocking policies before tool execution |
| `PostToolUse` | `hooks/scripts/hooks/hook-router.js` | Context monitoring, console warnings, async worker fan-out |
| `Stop` | `hooks/scripts/hooks/hook-router.js` | Stop-time notifications and audits |
| `Notification` | `hooks/scripts/hooks/hook-router.js` | Surface permission/problem notifications |
| `SubagentStop` | prompt hook in `hooks/hooks.json` | Lightweight evidence review for subagent output |

## `UserPromptSubmit` Flow

```text
Prompt arrives
  -> skill-activation-suggestions.js
  -> activation-rules.js matches keywords/patterns
  -> session-state.js suppresses duplicate suggestions within a session
  -> usage-telemetry.js records matched/suggested events
  -> hook returns additionalContext for Claude
```

### Output Shape

`UserPromptSubmit` can provide extra context without blocking the prompt:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "Relevant skills for this prompt:\n- systematic-debugging ..."
  }
}
```

If there is nothing useful to suggest, the script returns `{}`.

## Router Flow

`hook-router.js` handles:

- `PreToolUse`
- `PostToolUse`
- `Stop`
- `Notification`

It dispatches to policy modules, collects logs, appends metrics, appends usage events, and returns either:
- allow
- block
- hook-specific output

### Important boundary

The router is where mode/policy enforcement happens. It is not a generic “skill enforcement” engine.

## State and Telemetry

- Prompt suggestion dedupe state: `skill-activation` namespace via `getPersistentDataPath(...)`
- Router usage events: `hook-router/usage-events.jsonl`
- Router metrics: `hook-router/metrics.jsonl` when enabled

Preferred storage is `${CLAUDE_PLUGIN_DATA}` in plugin context. Outside plugin context, helpers fall back to temp storage.

## Testing

### Prompt suggestion smoke test

```bash
echo '{"session_id":"debug","hook_event_name":"UserPromptSubmit","prompt":"this test keeps failing"}' | \
  node hooks/scripts/hooks/skill-activation-suggestions.js
```

### Router replay

```bash
node hooks/scripts/tools/replay-hook-router.js --iterations 5
```

Use replay when changing router policies, mode rules, or worker dispatch behavior.
