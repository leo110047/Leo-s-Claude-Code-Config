#!/usr/bin/env bash
set -euo pipefail

runtime_root="${1:-}"
source_root="${2:-}"
case "$runtime_root:$source_root" in
  /*:/*) ;;
  *) echo "prepare workflow root requires absolute runtime and source roots" >&2; exit 2 ;;
esac
case "$runtime_root:$source_root" in
  /:*|*:/) echo "prepare workflow root refuses a filesystem root" >&2; exit 2 ;;
esac

mkdir -p "$runtime_root"
runtime_real="$(cd "$runtime_root" && pwd -P)"
source_real="$(cd "$source_root" && pwd -P)"
case "$runtime_real:$source_real" in
  /:*|*:/) echo "prepare workflow root refuses a canonical filesystem root" >&2; exit 2 ;;
esac
workflow_root="$runtime_real/workflows"
if [ "$runtime_real" = "$source_real" ]; then
  mkdir -p "$workflow_root"
else
  rm -rf "$workflow_root"
  mkdir -p "$workflow_root"
fi
