#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SETUP_SCRIPT="$ROOT_DIR/goldband-loop/setup"

run_required_missing_browser_fails() {
  local tmp_home log_file rc
  tmp_home="$(mktemp -d "${TMPDIR:-/tmp}/goldband-pw-required.XXXXXX")"
  log_file="$tmp_home/setup.log"

  set +e
  HOME="$tmp_home" \
    PLAYWRIGHT_BROWSERS_PATH="$tmp_home/pw-browsers" \
    GOLDBAND_SKIP_BUILD=1 \
    GOLDBAND_SKIP_GENERATE=1 \
    GOLDBAND_SKIP_COREUTILS=1 \
    GOLDBAND_PLAYWRIGHT_INSTALL_TIMEOUT_SECONDS=1 \
    "$SETUP_SCRIPT" --host claude --prefix > "$log_file" 2>&1
  rc=$?
  set -e

  if [ "$rc" -eq 0 ]; then
    echo "expected setup to fail when Playwright browser is missing" >&2
    cat "$log_file" >&2
    exit 1
  fi
  grep -q "goldband setup failed: Playwright Chromium install did not finish successfully" "$log_file"
  grep -q "GOLDBAND_SKIP_PLAYWRIGHT=1" "$log_file"
  if grep -q "goldband ready" "$log_file"; then
    echo "setup reported ready after required Playwright failure" >&2
    cat "$log_file" >&2
    exit 1
  fi
}

run_explicit_skip_succeeds() {
  local tmp_home log_file
  tmp_home="$(mktemp -d "${TMPDIR:-/tmp}/goldband-pw-skip.XXXXXX")"
  log_file="$tmp_home/setup.log"

  HOME="$tmp_home" \
    PLAYWRIGHT_BROWSERS_PATH="$tmp_home/pw-browsers" \
    GOLDBAND_SKIP_BUILD=1 \
    GOLDBAND_SKIP_GENERATE=1 \
    GOLDBAND_SKIP_PLAYWRIGHT=1 \
    GOLDBAND_SKIP_COREUTILS=1 \
    "$SETUP_SCRIPT" --host claude --prefix > "$log_file" 2>&1

  grep -q "Skipping Playwright Chromium install" "$log_file"
  grep -q "Browser workflows will be unavailable" "$log_file"
  grep -q "goldband ready (claude)." "$log_file"
}

run_required_missing_browser_fails
run_explicit_skip_succeeds

echo "[OK] Goldband Loop Playwright setup behavior verified"
