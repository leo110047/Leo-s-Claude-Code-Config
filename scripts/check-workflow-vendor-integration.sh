#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW_DIR="$ROOT_DIR/vendor/workflow"
INSTALLER="$ROOT_DIR/shell/install/workflow.sh"
LANGUAGE_SCRIPT="$ROOT_DIR/commands/scripts/set-goldband-language.sh"
RUNBOOK="$ROOT_DIR/WORKFLOW_VENDORING.md"
PATCH_DIR="$ROOT_DIR/patches/workflow"
PATCH_REPLAY_SCRIPT="$ROOT_DIR/scripts/apply-workflow-vendor-patches.sh"
EXIT_CODE=0

fail() {
  echo "[FAIL] $*"
  EXIT_CODE=1
}

ok() {
  echo "[OK] $*"
}

if [ ! -f "$WORKFLOW_DIR/VERSION" ]; then
  fail "vendor/workflow/VERSION missing"
  exit "$EXIT_CODE"
fi

if [ ! -f "$WORKFLOW_DIR/package.json" ]; then
  fail "vendor/workflow/package.json missing"
  exit "$EXIT_CODE"
fi

version="$(tr -d '\n' < "$WORKFLOW_DIR/VERSION")"
package_version="$(
  node -e 'const fs = require("fs"); process.stdout.write(JSON.parse(fs.readFileSync("vendor/workflow/package.json", "utf8")).version)' \
    2>/dev/null || true
)"
if [ "$version" = "$package_version" ]; then
  ok "workflow VERSION matches package.json ($version)"
else
  fail "workflow VERSION ($version) does not match package.json ($package_version)"
fi

manifest_lines="$(
  awk '
    /^workflow_wrapper_manifest\(\)/ { in_fn = 1; next }
    in_fn && /^EOF$/ { exit }
    in_fn && /^[a-zA-Z0-9-]+\|/ { print }
  ' "$INSTALLER"
)"

manifest_targets="$(
  printf '%s\n' "$manifest_lines" \
    | awk -F'|' '{ if ($2 != "") print $2 }' \
    | sort -u
)"

source_targets="$(
  find "$WORKFLOW_DIR" -mindepth 2 -maxdepth 2 -name SKILL.md -print \
    | sed "s|$WORKFLOW_DIR/||;s|/SKILL.md||" \
    | sort -u
)"

while IFS= read -r skill; do
  [ -n "$skill" ] || continue
  if printf '%s\n' "$manifest_targets" | grep -Fxq "$skill"; then
    ok "manifest covers $skill"
  else
    fail "workflow_wrapper_manifest missing source skill: $skill"
  fi
done <<< "$source_targets"

while IFS='|' read -r alias_name claude_target codex_target _zh _en; do
  [ -n "$alias_name" ] || continue
  case "$alias_name" in
    goldband-*) ;;
    *) fail "manifest alias must be goldband-prefixed: $alias_name" ;;
  esac
  if [ -n "$claude_target" ] && [ ! -f "$WORKFLOW_DIR/$claude_target/SKILL.md" ]; then
    fail "manifest target missing source SKILL.md: $claude_target"
  fi
  case "$codex_target" in
    ""|workflow-*) ;;
    *) fail "Codex target must be empty or workflow-prefixed for $alias_name: $codex_target" ;;
  esac

  if [ -x "$LANGUAGE_SCRIPT" ]; then
    zh_description="$("$LANGUAGE_SCRIPT" describe "$alias_name" zh-TW 2>/dev/null || true)"
    en_description="$("$LANGUAGE_SCRIPT" describe "$alias_name" en 2>/dev/null || true)"
    if [ "$zh_description" != "$_zh" ]; then
      fail "language script zh-TW description mismatch for $alias_name"
    fi
    if [ "$en_description" != "$_en" ]; then
      fail "language script en description mismatch for $alias_name"
    fi
  else
    fail "language script missing or not executable: commands/scripts/set-goldband-language.sh"
  fi
done <<< "$manifest_lines"

for bin in workflow-config workflow-repo-mode workflow-update-check workflow-review-log workflow-review-read; do
  if [ -x "$WORKFLOW_DIR/bin/$bin" ]; then
    ok "compat binary exists: $bin"
  else
    fail "compat binary missing or not executable: vendor/workflow/bin/$bin"
  fi
done

if [ -f "$RUNBOOK" ]; then
  ok "workflow vendoring runbook exists"
  for required in \
    "## Outcome" \
    "## Verification" \
    "## Constraints" \
    "## Iteration Policy" \
    "## Error Handling" \
    "scripts/apply-workflow-vendor-patches.sh" \
    "patches/workflow/" \
    "workflow_wrapper_manifest()"
  do
    if grep -Fq "$required" "$RUNBOOK"; then
      ok "runbook covers: $required"
    else
      fail "workflow vendoring runbook missing: $required"
    fi
  done
else
  fail "workflow vendoring runbook missing: WORKFLOW_VENDORING.md"
fi

if [ -x "$PATCH_REPLAY_SCRIPT" ]; then
  ok "workflow vendor patch replay script exists"
else
  fail "workflow vendor patch replay script missing or not executable: scripts/apply-workflow-vendor-patches.sh"
fi

if [ -d "$PATCH_DIR" ]; then
  patch_count="$(find "$PATCH_DIR" -maxdepth 1 -name '*.patch' -print | wc -l | tr -d ' ')"
  if [ "$patch_count" -gt 0 ]; then
    ok "workflow vendor patches registered: $patch_count"
  else
    fail "workflow vendor patch directory has no patch files"
  fi

  while IFS= read -r patch; do
    [ -n "$patch" ] || continue
    if git -C "$ROOT_DIR" apply --unidiff-zero --reverse --check "$patch" >/dev/null 2>&1; then
      ok "workflow vendor patch is applied: ${patch#$ROOT_DIR/}"
    else
      fail "workflow vendor patch is not applied cleanly: ${patch#$ROOT_DIR/}"
    fi
  done < <(find "$PATCH_DIR" -maxdepth 1 -name '*.patch' -print | sort)
else
  fail "workflow vendor patch directory missing: patches/workflow"
fi

if [ "$EXIT_CODE" -eq 0 ]; then
  ok "workflow vendor integration checks passed"
fi

exit "$EXIT_CODE"
