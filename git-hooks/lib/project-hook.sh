# This file is sourced by goldband git hooks.

goldband_project_hook_path() {
  local repo_root="$1"
  local common_dir="$2"
  local hook_name="$3"

  [ -n "$common_dir" ] || return 1
  case "$common_dir" in
    /*) printf '%s/hooks/%s\n' "$common_dir" "$hook_name" ;;
    *) printf '%s/%s/hooks/%s\n' "$repo_root" "$common_dir" "$hook_name" ;;
  esac
}

goldband_run_project_hook() {
  local repo_root="$1"
  local hook_dir="$2"
  local common_dir="$3"
  local hook_name="$4"
  shift 4

  [ "${GOLDBAND_PROJECT_HOOK_RUNNING:-0}" != "1" ] || return 0

  local project_hook goldband_hook
  project_hook="$(goldband_project_hook_path "$repo_root" "$common_dir" "$hook_name")" || return 0
  goldband_hook="$hook_dir/$hook_name"

  [ -e "$project_hook" ] || return 0
  if [ -d "$project_hook" ]; then
    echo "[goldband] WARNING: project $hook_name hook path is a directory, skipping: $project_hook" >&2
    return 0
  fi
  if [ ! -f "$project_hook" ]; then
    echo "[goldband] WARNING: project $hook_name hook is not a regular file, skipping: $project_hook" >&2
    return 0
  fi
  if [ ! -x "$project_hook" ]; then
    echo "[goldband] WARNING: project $hook_name hook exists but is not executable, skipping: $project_hook" >&2
    return 0
  fi
  if [ "$project_hook" = "$goldband_hook" ] || [ "$project_hook" -ef "$goldband_hook" ]; then
    return 0
  fi

  GOLDBAND_PROJECT_HOOK_RUNNING=1 "$project_hook" "$@"
}
