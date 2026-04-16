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

resolve_repo_dir() {
  if [ -n "${GOLDBAND_SELF_UPDATE_REPO_DIR:-}" ]; then
    printf '%s\n' "$GOLDBAND_SELF_UPDATE_REPO_DIR"
    return 0
  fi

  local script_dir
  script_dir="$(resolve_script_path)"
  cd "$script_dir/.." && pwd
}

main() {
  local repo_dir
  repo_dir="$(resolve_repo_dir)" || exit 0

  local skill_catalog_file="$repo_dir/shell/install/skill-catalog.txt"
  [ -f "$skill_catalog_file" ] || exit 0

  REPO_DIR="$repo_dir"
  CLAUDE_DIR="$HOME/.claude"
  SKILLS_DIR="$CLAUDE_DIR/skills"
  SKILL_PROFILE_FILE="$SKILLS_DIR/.goldband-profile"
  CODEX_SKILLS_DIR="$HOME/.agents/skills"
  CODEX_SKILL_PROFILE_FILE="$CODEX_SKILLS_DIR/.goldband-profile"
  SKILL_CATALOG_FILE="$skill_catalog_file"
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

  local changed=0

  if sync_existing_managed_skill_profile \
      "claude" \
      "$SKILLS_DIR" \
      "$SKILL_PROFILE_FILE" \
      "全域 Skills Profile" \
      "skill" \
      "write_skill_profile_file" \
      "$REPO_DIR/skills/global/README.md:README.md" \
      "$REPO_DIR/skills/global/skill-rules.json:skill-rules.json" \
      --; then
    changed=1
    printf '[goldband] synced Claude skills profile from repo catalog.\n' >&2
  fi

  if sync_existing_managed_skill_profile \
      "codex" \
      "$CODEX_SKILLS_DIR" \
      "$CODEX_SKILL_PROFILE_FILE" \
      "Codex Skills Profile" \
      "Codex skill" \
      "write_codex_skill_profile_file" \
      --; then
    changed=1
    printf '[goldband] synced Codex skills profile from repo catalog.\n' >&2
  fi

  exit 0
}

main "$@"
