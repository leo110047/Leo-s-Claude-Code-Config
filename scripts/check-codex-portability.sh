#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

targets=(
  "$ROOT_DIR/codex/config.toml"
  "$ROOT_DIR/codex/rules"
)

patterns=(
  '/Users/'
  'DISCORD_BOT_TOKEN'
  'access_token'
  'refresh_token'
)

failed=0

for pattern in "${patterns[@]}"; do
  if rg -n --fixed-strings "$pattern" "${targets[@]}"; then
    failed=1
  fi
done

if [ "$failed" -ne 0 ]; then
  echo "[FAIL] tracked Codex baseline contains machine-local or credential-shaped state"
  echo "Move local paths, trusted projects, plugin runtime state, and one-off approvals to codex/local/."
  exit 1
fi

echo "[OK] Codex portable baseline check passed"
