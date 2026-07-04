#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd -P)"

find_workflow_config_bin() {
  local candidate
  for candidate in \
    "$HOME/.codex/skills/goldband/bin/goldband-config" \
    "$HOME/.claude/skills/goldband/bin/goldband-config" \
    "$REPO_DIR/goldband-loop/bin/goldband-config"
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

main() {
  local mode="${1:-get}"
  local requested="${2:-}"
  local workflow_config_bin
  local normalized

  workflow_config_bin="$(find_workflow_config_bin)" || {
    echo "Goldband Loop config binary not found" >&2
    exit 1
  }

  case "$mode" in
    get)
      read_language "$workflow_config_bin"
      ;;
    set|sync)
      normalized="$(normalize_language "$requested")" || {
        echo "unsupported language: ${requested:-<empty>}" >&2
        exit 1
      }
      "$workflow_config_bin" set goldband_language "$normalized"
      printf '%s\n' "$normalized"
      ;;
    *)
      echo "usage: $0 {get|set <zh-TW|en>|sync <zh-TW|en>}" >&2
      exit 1
      ;;
  esac
}

main "$@"
