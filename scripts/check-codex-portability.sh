#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK_ROOT="${GOLDBAND_CODEX_PORTABILITY_ROOT:-$ROOT_DIR}"

targets=(
  "$CHECK_ROOT/codex/config.toml"
  "$CHECK_ROOT/codex/rules"
)

patterns=(
  '/Users/'
  'DISCORD_BOT_TOKEN'
  'access_token'
  'refresh_token'
)

failed=0

if ! command -v grep >/dev/null 2>&1; then
  echo "[FAIL] Codex portable baseline check requires grep" >&2
  exit 2
fi

for target in "${targets[@]}"; do
  if [ ! -e "$target" ]; then
    echo "[FAIL] Codex portable baseline target is missing: $target" >&2
    exit 2
  fi
done

for pattern in "${patterns[@]}"; do
  if grep -RInF -- "$pattern" "${targets[@]}"; then
    failed=1
  else
    status=$?
    if [ "$status" -ne 1 ]; then
      echo "[FAIL] Codex portable baseline scan failed for pattern: $pattern" >&2
      exit 2
    fi
  fi
done

if grep -RInE -- 'prefix_rule\(.*decision[[:space:]]*=[[:space:]]*"allow".*\)' "$CHECK_ROOT/codex/rules"; then
  failed=1
else
  status=$?
  if [ "$status" -ne 1 ]; then
    echo "[FAIL] Codex portable baseline approval scan failed" >&2
    exit 2
  fi
fi

if [ "$failed" -ne 0 ]; then
  echo "[FAIL] tracked Codex baseline contains machine-local or credential-shaped state"
  echo "Move local paths, trusted projects, plugin runtime state, and one-off approvals to codex/local/."
  echo "For one-off approvals, run: ./install.sh repair-codex-rules"
  exit 1
fi

echo "[OK] Codex portable baseline check passed"
