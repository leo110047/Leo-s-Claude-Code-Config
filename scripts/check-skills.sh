#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXIT_CODE=0
if [ -n "${GOLDBAND_SKILL_MAX_BYTES:-}" ]; then
  MAX_SKILL_BYTES="$GOLDBAND_SKILL_MAX_BYTES"
else
  MAX_SKILL_BYTES="$(
    cd "$ROOT_DIR"
    node --input-type=module -e "import('./scripts/lib/prompt-surface-budget.mjs').then((m) => process.stdout.write(String(m.PROMPT_SURFACE_BUDGETS.portableSkillBytes)))"
  )"
fi

check_skill_file() {
  local skill_file="$1"
  local rel
  rel="${skill_file#$ROOT_DIR/}"

  if [ ! -f "$skill_file" ]; then
    echo "[FAIL] $rel missing"
    EXIT_CODE=1
    return
  fi

  enforce_skill_file_budget "$skill_file" "$rel"

  if ! grep -q '^---$' "$skill_file"; then
    echo "[FAIL] $rel missing frontmatter"
    EXIT_CODE=1
    return
  fi

  local frontmatter
  frontmatter="$(sed -n '1,/^---$/p' "$skill_file")"

  check_required_frontmatter "$rel" "$frontmatter"
  check_special_frontmatter "$rel" "$frontmatter"
  check_skill_name "$skill_file" "$rel" "$frontmatter"
  check_skill_references "$skill_file" "$rel"
}

enforce_skill_file_budget() {
  local skill_file="$1"
  local rel="$2"
  local byte_count
  byte_count="$(wc -c < "$skill_file" | tr -d ' ')"
  if [ "$byte_count" -gt "$MAX_SKILL_BYTES" ]; then
    echo "[FAIL] $rel exceeds prompt surface budget ${MAX_SKILL_BYTES} bytes ($byte_count)"
    EXIT_CODE=1
  fi
}

check_required_frontmatter() {
  local rel="$1"
  local frontmatter="$2"
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
}

check_special_frontmatter() {
  local rel="$1"
  local frontmatter="$2"
  case "$rel" in
    skills/global/careful-mode/SKILL.md|skills/global/freeze-mode/SKILL.md)
      if ! printf '%s\n' "$frontmatter" | grep -q '^disable-model-invocation: true$'; then
        echo "[FAIL] $rel missing disable-model-invocation: true"
        EXIT_CODE=1
      fi
      ;;
  esac

  case "$rel" in
    skills/global/frontend-design/SKILL.md)
      if ! printf '%s\n' "$frontmatter" | grep -q '^paths:'; then
        echo "[FAIL] $rel missing paths:"
        EXIT_CODE=1
      fi
      ;;
  esac
}

check_skill_name() {
  local skill_file="$1"
  local rel="$2"
  local frontmatter="$3"
  local name
  name="$(printf '%s\n' "$frontmatter" | awk -F': *' '/^name:/{print $2; exit}')"
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
}

check_skill_references() {
  local skill_file="$1"
  local rel="$2"
  local skill_dir
  skill_dir="$(dirname "$skill_file")"
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
