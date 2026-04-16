#!/usr/bin/env bash
set -euo pipefail

resolve_script_path() {
  local source_path="${BASH_SOURCE[0]}"
  while [ -L "$source_path" ]; do
    local source_dir
    source_dir="$(cd -P "$(dirname "$source_path")" && pwd)"
    source_path="$(readlink "$source_path")"
    case "$source_path" in
      /*) ;;
      *) source_path="$source_dir/$source_path" ;;
    esac
  done
  cd -P "$(dirname "$source_path")" && pwd
}

main() {
  local script_dir
  script_dir="$(resolve_script_path)"
  local repo_dir
  repo_dir="$(cd "$script_dir/.." && pwd)"

  local host="${1:-auto}"

  REPO_DIR="$repo_dir"
  CLAUDE_DIR="$HOME/.claude"
  SKILLS_DIR="$CLAUDE_DIR/skills"
  SKILL_PROFILE_FILE="$SKILLS_DIR/.goldband-profile"
  CLAUDE_BIN_DIR="$CLAUDE_DIR/bin"
  CLAUDE_SHELL_DIR="$CLAUDE_DIR/shell"
  SHELL_UPDATE_BIN="$CLAUDE_BIN_DIR/goldband-self-update"
  SHELL_LAUNCHERS_FILE="$CLAUDE_SHELL_DIR/goldband-launchers.sh"
  ZSHRC_FILE="${ZDOTDIR:-$HOME}/.zshrc"
  CODEX_DIR="$HOME/.codex"
  CODEX_CONFIG_FILE="$CODEX_DIR/config.toml"
  CODEX_AGENTS_FILE="$CODEX_DIR/AGENTS.md"
  CODEX_RULES_DIR="$CODEX_DIR/rules"
  CODEX_SKILLS_DIR="$HOME/.agents/skills"
  CODEX_SKILL_PROFILE_FILE="$CODEX_SKILLS_DIR/.goldband-profile"
  SKILL_CATALOG_FILE="$REPO_DIR/shell/install/skill-catalog.txt"

  RED=''
  GREEN=''
  YELLOW=''
  BLUE=''
  CYAN=''
  NC=''

  skill_catalog() {
    cat "$SKILL_CATALOG_FILE"
  }

  # shellcheck source=/dev/null
  . "$REPO_DIR/shell/install/common.sh"
  # shellcheck source=/dev/null
  . "$REPO_DIR/shell/install/workflow.sh"

  install_workflow_host "$host"
}

main "$@"
