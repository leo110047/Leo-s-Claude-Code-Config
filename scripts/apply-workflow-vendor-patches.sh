#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PATCH_DIR="$ROOT_DIR/patches/workflow"

if [ ! -d "$PATCH_DIR" ]; then
  echo "[OK] no workflow vendor patch directory"
  exit 0
fi

found_patch=0
for patch in "$PATCH_DIR"/*.patch; do
  [ -e "$patch" ] || continue
  found_patch=1

  if git -C "$ROOT_DIR" apply --unidiff-zero --reverse --check "$patch" >/dev/null 2>&1; then
    echo "[OK] already applied: ${patch#$ROOT_DIR/}"
    continue
  fi

  echo "[APPLY] ${patch#$ROOT_DIR/}"
  git -C "$ROOT_DIR" apply --unidiff-zero "$patch"
done

if [ "$found_patch" -eq 0 ]; then
  echo "[OK] no workflow vendor patches"
fi
