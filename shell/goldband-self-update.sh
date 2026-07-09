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

run_skill_sync() {
  local repo_dir="$1"
  local sync_script="$repo_dir/shell/goldband-sync-skills.sh"
  [ -x "$sync_script" ] || return 0
  GOLDBAND_SELF_UPDATE_REPO_DIR="$repo_dir" "$sync_script" || true
}

run_installed_surface_refresh() {
  local repo_dir="$1"
  local old_head="$2"
  local new_head="$3"
  local install_script="$repo_dir/install.sh"
  [ -x "$install_script" ] || return 0

  local state_root log_file tmp_log refresh_status
  state_root="${GOLDBAND_HOME:-$HOME/.goldband}"
  mkdir -p "$state_root"
  log_file="$state_root/last-auto-refresh.log"
  tmp_log="$log_file.tmp.$$"

  set +e
  GOLDBAND_AUTO_REFRESH=1 \
  GOLDBAND_AUTO_REFRESH_OLD_HEAD="$old_head" \
  GOLDBAND_AUTO_REFRESH_NEW_HEAD="$new_head" \
    "$install_script" auto-refresh >"$tmp_log" 2>&1
  refresh_status=$?
  set -e

  mv "$tmp_log" "$log_file" 2>/dev/null || true
  if [ "$refresh_status" -ne 0 ]; then
    printf '[goldband] auto-refresh partially failed; see %s\n' "$log_file" >&2
  fi
}

run_git_with_timeout() {
  local repo_dir="$1"
  shift
  local timeout_seconds="${GOLDBAND_SELF_UPDATE_TIMEOUT:-4}"

  if command -v timeout >/dev/null 2>&1; then
    run_git_with_unix_timeout "$repo_dir" "$timeout_seconds" "$@"
    return $?
  fi

  if ! command -v python3 >/dev/null 2>&1; then
    run_git_without_timeout "$repo_dir" "$@"
    return $?
  fi

  run_git_with_python_timeout "$repo_dir" "$timeout_seconds" "$@"
}

run_git_with_unix_timeout() {
  local repo_dir="$1"
  local timeout_seconds="$2"
  shift 2
  (
    cd "$repo_dir" &&
    GIT_TERMINAL_PROMPT=0 timeout "$timeout_seconds" "$@" >/dev/null 2>&1
  )
}

run_git_without_timeout() {
  local repo_dir="$1"
  shift
  (
    cd "$repo_dir" &&
    GIT_TERMINAL_PROMPT=0 "$@" >/dev/null 2>&1
  )
}

python_timeout_cwd() {
  local repo_dir="$1"
  local python_cwd="$repo_dir"
  if command -v cygpath >/dev/null 2>&1; then
    python_cwd="$(cygpath -w "$repo_dir" 2>/dev/null || printf '%s' "$repo_dir")"
  fi
  printf '%s\n' "$python_cwd"
}

run_git_with_python_timeout() {
  local repo_dir="$1"
  local timeout_seconds="$2"
  shift 2
  local python_cwd
  python_cwd="$(python_timeout_cwd "$repo_dir")"
  python3 - "$timeout_seconds" "$python_cwd" "$@" <<'PY'
import os
import subprocess
import sys

timeout = float(sys.argv[1])
cwd = sys.argv[2]
cmd = sys.argv[3:]
env = os.environ.copy()
env["GIT_TERMINAL_PROMPT"] = "0"

try:
    result = subprocess.run(
        cmd,
        cwd=cwd,
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=timeout,
        check=False,
    )
except subprocess.TimeoutExpired:
    sys.exit(124)

sys.stdout.write(result.stdout)
sys.stderr.write(result.stderr)
sys.exit(result.returncode)
PY
}

main() {
  local repo_dir
  repo_dir="$(resolve_repo_dir)" || exit 0

  run_skill_sync "$repo_dir"

  git -C "$repo_dir" rev-parse --git-dir >/dev/null 2>&1 || exit 0

  local branch upstream
  branch="$(git -C "$repo_dir" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  upstream="$(git -C "$repo_dir" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)"

  [ "$branch" = "main" ] || exit 0
  [ "$upstream" = "origin/main" ] || exit 0

  run_git_with_timeout "$repo_dir" git fetch --quiet origin main >/dev/null 2>&1 || exit 0

  local counts ahead behind
  counts="$(git -C "$repo_dir" rev-list --left-right --count HEAD...origin/main 2>/dev/null || true)"
  ahead="$(printf '%s\n' "$counts" | awk '{print $1}')"
  behind="$(printf '%s\n' "$counts" | awk '{print $2}')"

  [ "${behind:-0}" -gt 0 ] || exit 0
  [ "${ahead:-0}" -eq 0 ] || exit 0

  local old_head new_head
  old_head="$(git -C "$repo_dir" rev-parse --short HEAD 2>/dev/null || echo "unknown")"
  run_git_with_timeout "$repo_dir" git pull --ff-only --quiet origin main >/dev/null 2>&1 || exit 0
  new_head="$(git -C "$repo_dir" rev-parse --short HEAD 2>/dev/null || echo "unknown")"

  if [ "$new_head" != "$old_head" ]; then
    run_skill_sync "$repo_dir"
    run_installed_surface_refresh "$repo_dir" "$old_head" "$new_head"
    printf '[goldband] updated %s -> %s; installed settings refreshed when safe.\n' "$old_head" "$new_head" >&2
  fi
}

main "$@"
