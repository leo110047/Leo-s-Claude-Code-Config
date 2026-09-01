#!/usr/bin/env bash
# Migration: preserve the provider-neutral artifacts-sync config rename.
#
# This historical migration intentionally performs one local Goldband-owned
# config rewrite. It does not inspect or mutate host MCP registration, external
# resources, user-owned provider data, or remote repositories.
set -euo pipefail

if [ -z "${HOME:-}" ]; then
  echo "  [v1.27.0.0] HOME is unset — skipping migration." >&2
  exit 0
fi

CONFIG_FILE="$HOME/.goldband/config.yaml"
[ -f "$CONFIG_FILE" ] || exit 0

TMP_FILE="${CONFIG_FILE}.tmp.$$"
trap 'rm -f "$TMP_FILE"' EXIT
sed -e 's/^gbrain_sync_mode:/artifacts_sync_mode:/' \
    -e 's/^gbrain_sync_mode_prompted:/artifacts_sync_mode_prompted:/' \
    "$CONFIG_FILE" > "$TMP_FILE"
chmod --reference="$CONFIG_FILE" "$TMP_FILE" 2>/dev/null || chmod 600 "$TMP_FILE"
mv "$TMP_FILE" "$CONFIG_FILE"
trap - EXIT
