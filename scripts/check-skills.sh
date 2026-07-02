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

  local frontmatter
  frontmatter="$(sed -n '1,/^---$/p' "$skill_file")"

  local name
  name="$(printf '%s\n' "$frontmatter" | awk -F': *' '/^name:/{print $2; exit}')"

  if [ -z "$name" ]; then
    echo "[FAIL] $rel missing name:"
    EXIT_CODE=1
  fi

  if ! printf '%s\n' "$frontmatter" | grep -q '^description:'; then
    echo "[FAIL] $rel missing description:"
    EXIT_CODE=1
  fi

  if printf '%s\n' "$frontmatter" | grep -q '^priority:'; then
    echo "[FAIL] $rel uses non-standard frontmatter priority:"
    EXIT_CODE=1
  fi

  if [[ "$rel" == skills/global/*/SKILL.md ]] \
    && ! printf '%s\n' "$frontmatter" | grep -q '^allowed-tools:'; then
    echo "[FAIL] $rel missing allowed-tools:"
    EXIT_CODE=1
  fi

  case "$rel" in
    skills/global/careful-mode/SKILL.md|skills/global/freeze-mode/SKILL.md)
      if ! printf '%s\n' "$frontmatter" | grep -q '^disable-model-invocation: true$'; then
        echo "[FAIL] $rel missing disable-model-invocation: true"
        EXIT_CODE=1
      fi
      ;;
  esac

  case "$rel" in
    skills/global/frontend-design/SKILL.md|skills/projects/unity/*/SKILL.md)
      if ! printf '%s\n' "$frontmatter" | grep -q '^paths:'; then
        echo "[FAIL] $rel missing paths:"
        EXIT_CODE=1
      fi
      ;;
  esac

  local skill_dir
  skill_dir="$(dirname "$skill_file")"
  local expected_name
  expected_name="$(basename "$skill_dir")"

  if [ -n "$name" ] && [ "$name" != "$expected_name" ]; then
    echo "[FAIL] $rel name '$name' does not match directory '$expected_name'"
    EXIT_CODE=1
  fi

  if [ -n "$name" ] && ! printf '%s\n' "$name" | grep -Eq '^[a-z0-9]+(-[a-z0-9]+)*$'; then
    echo "[FAIL] $rel name '$name' is not lowercase kebab-case"
    EXIT_CODE=1
  fi

  local ref
  while IFS= read -r ref; do
    [ -n "$ref" ] || continue
    if [ ! -f "$skill_dir/$ref" ]; then
      echo "[FAIL] $rel references missing $ref"
      EXIT_CODE=1
    fi
  done < <(grep -Eo 'reference/[[:alnum:]_-]+\.md' "$skill_file" 2>/dev/null | sort -u || true)
}

while IFS= read -r skill_file; do
  check_skill_file "$skill_file"
done < <(find "$ROOT_DIR/skills" -name SKILL.md | sort)

if [ "$EXIT_CODE" -eq 0 ]; then
  echo "[OK] skill checks passed"
fi

exit "$EXIT_CODE"
