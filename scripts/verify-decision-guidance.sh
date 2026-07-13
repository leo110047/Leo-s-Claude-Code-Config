#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXIT_CODE=0

check_contains() {
  local rel="$1"
  local pattern="$2"
  local label="$3"
  local file="$ROOT_DIR/$rel"

  if grep -Fq "$pattern" "$file"; then
    echo "[OK] $label"
  else
    echo "[FAIL] $label missing in $rel"
    EXIT_CODE=1
  fi
}

check_contains_any() {
  local rel="$1"
  local label="$2"
  shift 2
  local file="$ROOT_DIR/$rel"
  local pattern

  for pattern in "$@"; do
    if grep -Fq "$pattern" "$file"; then
      echo "[OK] $label"
      return 0
    fi
  done

  echo "[FAIL] $label missing in $rel"
  EXIT_CODE=1
}

if [ -f "$ROOT_DIR/ARCHITECTURE.md" ]; then
  echo "[OK] architecture boundary document exists"
else
  echo "[FAIL] ARCHITECTURE.md missing"
  EXIT_CODE=1
fi

check_contains "ARCHITECTURE.md" "## Responsibility Boundary" "architecture doc defines responsibility boundary"
check_contains "ARCHITECTURE.md" "## Integration Contract" "architecture doc defines integration contract"
check_contains "ARCHITECTURE.md" "goldband-loop owns" "architecture doc explains Goldband Loop ownership"
check_contains "ARCHITECTURE.md" "inventory gate" "architecture doc explains inventory gate"
check_contains "goldband-loop/inventory.json" "\"runtimeRoot\": \"goldband\"" "Goldband Loop inventory declares runtime root"

check_contains "skills/global/systematic-debugging/SKILL.md" "healthiest complete fix" "systematic-debugging skill keeps healthiest complete fix policy"
check_contains "goldband-loop/investigate/SKILL.md" "healthiest complete fix" "Goldband Loop investigate skill defaults debugging toward the healthiest complete fix"
check_contains "goldband-loop/investigate/SKILL.md" "blast radius intentional" "Goldband Loop investigate skill constrains blast radius without minimal-fix bias"
check_contains "goldband-loop/investigate/SKILL.md.tmpl" "healthiest complete fix" "Goldband Loop investigate template defaults debugging toward the healthiest complete fix"
check_contains "goldband-loop/investigate/SKILL.md.tmpl" "blast radius intentional" "Goldband Loop investigate template constrains blast radius without minimal-fix bias"
check_contains "goldband-loop/plan-eng-review/SKILL.md" "Healthiest maintainable path" "plan-eng-review defaults recommendations toward the healthiest maintainable path"
check_contains "goldband-loop/plan-eng-review/SKILL.md.tmpl" "Healthiest maintainable path" "plan-eng-review template defaults recommendations toward the healthiest maintainable path"
check_contains "goldband-loop/plan-ceo-review/SKILL.md" "Healthiest maintainable path" "plan-ceo-review defaults recommendations toward the healthiest maintainable path"
check_contains "goldband-loop/plan-ceo-review/SKILL.md.tmpl" "Healthiest maintainable path" "plan-ceo-review template defaults recommendations toward the healthiest maintainable path"
check_contains "goldband-loop/qa/SKILL.md" "healthiest complete fix" "Goldband Loop qa uses healthiest complete fix wording"
check_contains "goldband-loop/qa/SKILL.md.tmpl" "healthiest complete fix" "Goldband Loop qa template uses healthiest complete fix wording"
check_contains "goldband-loop/design-review/SKILL.md" "healthiest complete fix" "Goldband Loop design-review uses healthiest complete fix wording"
check_contains "goldband-loop/design-review/SKILL.md.tmpl" "healthiest complete fix" "Goldband Loop design-review template uses healthiest complete fix wording"
check_contains "goldband-loop/scripts/resolvers/preamble.ts" "healthiest complete fix" "Goldband Loop preamble points investigate handoff to the healthiest complete fix"

check_contains "commands/discuss.md" "Failure Modes:" "discuss command requires failure modes"
check_contains "commands/discuss.md" "Switch Criteria:" "discuss command requires switch criteria"
check_contains "commands/discuss.md" "Unknowns to Verify:" "discuss command requires unknowns"

check_contains "commands/plan.md" "## Decision Check" "plan command includes decision check"
check_contains "commands/plan.md" "## Pre-Mortem" "plan command includes pre-mortem"
check_contains "commands/plan.md" "Fallback Path:" "plan command includes fallback path"

check_contains "skills/global/planning-workflow/SKILL.md" "## Decision-Quality Block" "planning-workflow decision-quality block"
check_contains "skills/global/planning-workflow/SKILL.md" "/plan" "planning-workflow defers full workflow planning"
check_contains "skills/global/security-checklist/SKILL.md" "Goldband cso workflow" "security-checklist defers deep security workflow"
check_contains "skills/global/decision-log/SKILL.md" "### Failure Signals" "decision-log failure signals section"
check_contains "skills/global/decision-log/SKILL.md" "### Revisit Triggers / Exit Criteria" "decision-log revisit triggers section"

check_contains "README.md" "goldband-loop/" "README references Goldband Loop runtime source"
check_contains "README.md" "workflow runtime" "README documents Goldband Loop as workflow runtime"
check_contains "README.md" "ARCHITECTURE.md" "README points boundary details to architecture"
check_contains_any "README.md" "README mentions decision recommendation guidance" \
  "decision recommendation standard" \
  "方向建議時會要求交代假設、失敗模式、替代方案與待驗證未知數"
check_contains_any "README.md" "README documents healthiest-path default" \
  "預設優先健康且可維護的路徑" \
  "方向判斷預設優先健康且可維護的路徑"
check_contains "README.en.md" "goldband-loop/" "README.en references Goldband Loop runtime source"
check_contains "README.en.md" "workflow runtime" "README.en documents Goldband Loop as workflow runtime"
check_contains "README.en.md" "ARCHITECTURE.md" "README.en points boundary details to architecture"
check_contains_any "README.en.md" "README.en mentions decision recommendation guidance" \
  "decision recommendation standard" \
  "directional recommendations are expected to surface assumptions, failure modes, alternatives, and unknowns"
check_contains_any "README.en.md" "README.en documents healthiest-path default" \
  "healthiest maintainable path" \
  "directional work defaults to the healthiest maintainable path"
check_contains "commands/verify-config.md" "scripts/verify-decision-guidance.sh" "verify-config documents decision guidance check"

if [ "$EXIT_CODE" -eq 0 ]; then
  echo "[OK] decision guidance checks passed"
fi

exit "$EXIT_CODE"
