#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXIT_CODE=0

check_skill_file() {
  local skill_file="$1"
  local rel
  rel="${skill_file#$ROOT_DIR/}"

  if [ ! -f "$skill_file" ]; then
    echo "[FAIL] $rel missing"
    EXIT_CODE=1
    return
  fi

  local line_count
  line_count="$(wc -l < "$skill_file" | tr -d ' ')"
  if [ "$line_count" -gt 500 ]; then
    echo "[WARN] $rel over 500 lines ($line_count)"
  fi

  if ! grep -q '^---$' "$skill_file"; then
    echo "[FAIL] $rel missing frontmatter"
    EXIT_CODE=1
    return
  fi

  if ! grep -q '^name:' "$skill_file"; then
    echo "[FAIL] $rel missing name:"
    EXIT_CODE=1
  fi

  if ! grep -q '^description:' "$skill_file"; then
    echo "[FAIL] $rel missing description:"
    EXIT_CODE=1
  fi
}

while IFS= read -r skill_file; do
  check_skill_file "$skill_file"
done < <(find "$ROOT_DIR/skills" -name SKILL.md | sort)

if [ "$EXIT_CODE" -eq 0 ]; then
  echo "[OK] skill checks passed"
fi

exit "$EXIT_CODE"
