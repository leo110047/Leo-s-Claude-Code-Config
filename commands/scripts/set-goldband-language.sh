#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
INSTALLER="$REPO_DIR/shell/install/workflow.sh"

find_workflow_config_bin() {
  local candidate
  for candidate in \
    "$HOME/.codex/skills/workflow/bin/gstack-config" \
    "$HOME/.claude/skills/workflow/bin/gstack-config" \
    "$REPO_DIR/vendor/workflow/bin/gstack-config" \
    "$HOME/.codex/skills/workflow/bin/workflow-config" \
    "$HOME/.claude/skills/workflow/bin/workflow-config" \
    "$REPO_DIR/vendor/workflow/bin/workflow-config"
  do
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

normalize_language() {
  local value="${1:-}"
  case "$value" in
    zh-TW|zh|tw|中文|繁中) printf 'zh-TW\n' ;;
    en|english|英文) printf 'en\n' ;;
    *) return 1 ;;
  esac
}

read_language() {
  local workflow_config_bin="$1"
  local current
  current="$("$workflow_config_bin" get goldband_language 2>/dev/null || true)"
  if [ -n "$current" ]; then
    printf '%s\n' "$current"
  else
    printf 'zh-TW\n'
  fi
}

workflow_manifest_lines() {
  if [ ! -f "$INSTALLER" ]; then
    echo "workflow installer manifest not found: $INSTALLER" >&2
    return 1
  fi

  awk '
    /^workflow_wrapper_manifest\(\)/ { in_fn = 1; next }
    in_fn && /^EOF$/ { exit }
    in_fn && /^[a-zA-Z0-9-]+\|/ { print }
  ' "$INSTALLER"
}

wrapper_description() {
  local wrapper_name="$1"
  local language="$2"

  workflow_manifest_lines \
    | awk -F'|' -v name="$wrapper_name" -v lang="$language" '
        $1 == name {
          if (lang == "en") {
            print $5
          } else {
            print $4
          }
          found = 1
        }
        END { exit(found ? 0 : 1) }
      '
}

rewrite_skill_description() {
  local skill_file="$1"
  local description="$2"
  local temp_desc
  temp_desc="$(mktemp)"
  printf '  %s\n' "$description" > "$temp_desc"

  awk -v desc_file="$temp_desc" '
    BEGIN {
      in_description = 0
      replaced = 0
    }
    replaced == 0 && $0 ~ /^description: [^|].*$/ {
      print "description: |"
      while ((getline line < desc_file) > 0) print line
      close(desc_file)
      replaced = 1
      next
    }
    replaced == 0 && $0 ~ /^description: \|$/ {
      print $0
      in_description = 1
      next
    }
    in_description == 1 {
      if ($0 ~ /^allowed-tools:/ || $0 ~ /^hooks:/ || $0 ~ /^---$/) {
        while ((getline line < desc_file) > 0) print line
        close(desc_file)
        print $0
        in_description = 0
        replaced = 1
        next
      }
      next
    }
    { print }
  ' "$skill_file" > "${skill_file}.tmp"

  mv "${skill_file}.tmp" "$skill_file"
  rm -f "$temp_desc"
}

sync_wrapper_descriptions() {
  local language="$1"
  local skill_file wrapper_name description

  for skill_file in "$HOME/.claude/skills"/goldband-*/SKILL.md "$HOME/.codex/skills"/goldband-*/SKILL.md; do
    [ -f "$skill_file" ] || continue
    wrapper_name="$(basename "$(dirname "$skill_file")")"
    description="$(wrapper_description "$wrapper_name" "$language" 2>/dev/null || true)"
    [ -n "$description" ] || continue
    rewrite_skill_description "$skill_file" "$description"
  done
}

main() {
  local mode="${1:-sync}"
  local requested="${2:-}"
  local workflow_config_bin
  local language

  if [ "$mode" = "describe" ]; then
    local wrapper_name="${2:-}"
    language="$(normalize_language "${3:-zh-TW}")" || {
      echo "unsupported language: ${3:-<empty>}" >&2
      exit 1
    }
    wrapper_description "$wrapper_name" "$language"
    exit 0
  fi

  workflow_config_bin="$(find_workflow_config_bin)" || {
    echo "workflow config binary not found" >&2
    exit 1
  }

  case "$mode" in
    set)
      language="$(normalize_language "$requested")" || {
        echo "unsupported language: ${requested:-<empty>}" >&2
        exit 1
      }
      "$workflow_config_bin" set goldband_language "$language"
      ;;
    sync)
      if [ -n "$requested" ]; then
        language="$(normalize_language "$requested")" || {
          echo "unsupported language: $requested" >&2
          exit 1
        }
      else
        language="$(read_language "$workflow_config_bin")"
      fi
      ;;
    get)
      read_language "$workflow_config_bin"
      exit 0
      ;;
    *)
      echo "usage: $0 {set <zh-TW|en>|sync [zh-TW|en]|get}" >&2
      exit 1
      ;;
  esac

  if [ -z "${language:-}" ]; then
    language="$(read_language "$workflow_config_bin")"
  fi

  sync_wrapper_descriptions "$language"
  printf '%s\n' "$language"
}

main "$@"
