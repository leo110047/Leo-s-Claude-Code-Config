---
name: goldband-unfreeze
version: 0.1.0
description: |
  Clear the freeze boundary set by /freeze, allowing edits to all directories
  again. Use when you want to widen edit scope without ending the session.
  Use when asked to "unfreeze", "unlock edits", "remove freeze", or
  "allow all edits". (goldband)
triggers:
  - unfreeze edits
  - unlock all directories
  - remove edit restrictions
allowed-tools:
  - Bash
  - Read
---
<!-- AUTO-GENERATED from SKILL.md.tmpl — do not edit directly -->
<!-- Regenerate: bun run gen:skill-docs -->

# /unfreeze — Clear Freeze Boundary

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

Remove the edit restriction set by `/freeze`, allowing edits to all directories.

```bash
mkdir -p ~/.goldband/analytics
echo '{"skill":"unfreeze","ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","repo":"'$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || echo "unknown")'"}'  >> ~/.goldband/analytics/skill-usage.jsonl 2>/dev/null || true
```

## Clear the boundary

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
eval "$($GOLDBAND_BIN/goldband-paths)"
STATE_DIR="$GOLDBAND_STATE_ROOT"
if [ -f "$STATE_DIR/freeze-dir.txt" ]; then
  PREV=$(cat "$STATE_DIR/freeze-dir.txt")
  rm -f "$STATE_DIR/freeze-dir.txt"
  echo "Freeze boundary cleared (was: $PREV). Edits are now allowed everywhere."
else
  echo "No freeze boundary was set."
fi
```

Tell the user the result. Note that `/freeze` hooks are still registered for the
session — they will just allow everything since no state file exists. To re-freeze,
run `/freeze` again.
