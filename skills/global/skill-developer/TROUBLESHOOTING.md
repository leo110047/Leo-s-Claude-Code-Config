# Troubleshooting

Debugging guide for skill suggestions, hook wiring, and repo verification.

## Prompt Suggestion Does Not Appear

### 1. Verify the hook is installed

`hooks/hooks.json` must contain `UserPromptSubmit`, and `~/.claude/settings.json` must have the merged command.

Quick check:

```bash
node skills/global/claude-config-verification/scripts/verify-claude-config.js
```

### 2. Smoke test the script directly

```bash
echo '{"session_id":"debug","hook_event_name":"UserPromptSubmit","prompt":"this test keeps failing"}' | \
  node hooks/scripts/hooks/skill-activation-suggestions.js
```

Expected outcome: JSON with `hookSpecificOutput.additionalContext`.

### 3. Check the rule

Inspect:

- `hooks/scripts/lib/skill-activation/activation-rules.js`

Common issues:
- keyword too narrow
- regex too broad or too strict
- wrong conflict rule suppressing the intended skill

### 4. Check session dedupe

The suggestion hook suppresses repeated identical suggestion sets within one session.

State lives under the `skill-activation` namespace via `getPersistentDataPath(...)`:
- plugin context: `${CLAUDE_PLUGIN_DATA}/skill-activation/...`
- non-plugin context: temp fallback

If you are retesting the same session repeatedly, change `session_id` or remove the corresponding state file.

## Wrong Skill Suggested

Check `activation-rules.js` in this order:

1. matched keywords
2. matched regex patterns
3. priority ordering
4. conflict suppression

Do not fix this by inflating descriptions first if the bad result comes from `UserPromptSubmit`.

## Hook Changes Do Not Show Up In Claude Code

Re-merge hook config:

```bash
./install.sh hooks
```

Then inspect `~/.claude/settings.json` to confirm the merged `UserPromptSubmit` / router entries are present.

## Persistent State Path Looks Wrong

Probe plugin data support explicitly:

```bash
node skills/global/claude-config-verification/scripts/probe-plugin-data.js
```

Interpretation:
- inside plugin context on supported runtimes, `${CLAUDE_PLUGIN_DATA}` should be used
- standalone shell execution may still fall back to temp

## Router Policy Change Needs Confidence

Use replay, not guesswork:

```bash
node hooks/scripts/tools/replay-hook-router.js --iterations 5
```

If the change touched mode rules or blocking behavior, replay is the minimum evidence bar before claiming safety.
