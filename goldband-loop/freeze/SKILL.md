---
name: goldband-freeze
version: 0.1.0
description: |
  Restrict file edits to a specific directory for the session. Blocks Edit and
  Write outside the allowed path. Use when debugging to prevent accidentally
  "fixing" unrelated code, or when you want to scope changes to one module.
  Use when asked to "freeze", "restrict edits", "only edit this folder",
  or "lock down edits". (goldband)
triggers:
  - freeze edits to directory
  - lock editing scope
  - restrict file changes
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
hooks:
  PreToolUse:
    - matcher: "Edit"
      hooks:
        - type: command
          command: "bash ${CLAUDE_SKILL_DIR}/bin/check-freeze.sh"
          statusMessage: "Checking freeze boundary..."
    - matcher: "Write"
      hooks:
        - type: command
          command: "bash ${CLAUDE_SKILL_DIR}/bin/check-freeze.sh"
          statusMessage: "Checking freeze boundary..."
---
<!-- AUTO-GENERATED from SKILL.md.tmpl — do not edit directly -->
<!-- Regenerate: bun run gen:skill-docs -->

# /freeze — Restrict Edits to a Directory

```bash
# Goldband runtime contract (block-local; generated)
_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
GOLDBAND_GLOBAL_ROOT="$HOME/.claude/skills/goldband"
GOLDBAND_LOCAL_REL=".claude/skills/goldband"
GOLDBAND_LOCAL_ROOT=""
[ -n "$_ROOT" ] && GOLDBAND_LOCAL_ROOT="$_ROOT/$GOLDBAND_LOCAL_REL"
GOLDBAND_ROOT="$GOLDBAND_GLOBAL_ROOT"
[ -n "$GOLDBAND_LOCAL_ROOT" ] && [ -d "$GOLDBAND_LOCAL_ROOT" ] && GOLDBAND_ROOT="$GOLDBAND_LOCAL_ROOT"
GOLDBAND_BIN="$GOLDBAND_ROOT/bin"
GOLDBAND_BROWSE="$GOLDBAND_ROOT/browse/dist"
GOLDBAND_DESIGN="$GOLDBAND_ROOT/design/dist"
GOLDBAND_MAKE_PDF="$GOLDBAND_ROOT/make-pdf/dist"
```

Lock file edits to a specific directory. Any Edit or Write operation targeting
a file outside the allowed path will be **blocked** (not just warned).

```bash
mkdir -p ~/.goldband/analytics
echo '{"skill":"freeze","ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","repo":"'$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || echo "unknown")'"}'  >> ~/.goldband/analytics/skill-usage.jsonl 2>/dev/null || true
```

## Setup

Ask the user which directory to restrict edits to. Use AskUserQuestion:

- Question: "Which directory should I restrict edits to? Files outside this path will be blocked from editing."
- Text input (not multiple choice) — the user types a path.

Once the user provides a directory path:

1. Resolve it to an absolute path:
```bash
FREEZE_DIR=$(cd "<user-provided-path>" 2>/dev/null && pwd)
echo "$FREEZE_DIR"
```

2. Ensure trailing slash and save to the freeze state file:
```bash
# Goldband runtime contract (block-local; generated)
_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
GOLDBAND_GLOBAL_ROOT="$HOME/.claude/skills/goldband"
GOLDBAND_LOCAL_REL=".claude/skills/goldband"
GOLDBAND_LOCAL_ROOT=""
[ -n "$_ROOT" ] && GOLDBAND_LOCAL_ROOT="$_ROOT/$GOLDBAND_LOCAL_REL"
GOLDBAND_ROOT="$GOLDBAND_GLOBAL_ROOT"
[ -n "$GOLDBAND_LOCAL_ROOT" ] && [ -d "$GOLDBAND_LOCAL_ROOT" ] && GOLDBAND_ROOT="$GOLDBAND_LOCAL_ROOT"
GOLDBAND_BIN="$GOLDBAND_ROOT/bin"
FREEZE_DIR="${FREEZE_DIR%/}/"
eval "$($GOLDBAND_BIN/goldband-paths)"
STATE_DIR="$GOLDBAND_STATE_ROOT"
mkdir -p "$STATE_DIR"
echo "$FREEZE_DIR" > "$STATE_DIR/freeze-dir.txt"
echo "Freeze boundary set: $FREEZE_DIR"
```

Tell the user: "Edits are now restricted to `<path>/`. Any Edit or Write
outside this directory will be blocked. To change the boundary, run `/freeze`
again. To remove it, run `/unfreeze` or end the session."

## How it works

The hook reads `file_path` from the Edit/Write tool input JSON, then checks
whether the path starts with the freeze directory. If not, it returns
`permissionDecision: "deny"` to block the operation.

The freeze boundary persists for the session via the state file. The hook
script reads it on every Edit/Write invocation.

## Notes

- The trailing `/` on the freeze directory prevents `/src` from matching `/src-old`
- Freeze applies to Edit and Write tools only — Read, Bash, Glob, Grep are unaffected
- This prevents accidental edits, not a security boundary — Bash commands like `sed` can still modify files outside the boundary
- To deactivate, run `/unfreeze` or end the conversation
