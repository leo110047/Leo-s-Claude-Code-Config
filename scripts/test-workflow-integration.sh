#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_HOME="$(mktemp -d /tmp/goldband-loop-home.XXXXXX)"
TMP_ROOT="$(mktemp -d /tmp/goldband-loop-root.XXXXXX)"
trap 'rm -rf "$TMP_HOME" "$TMP_ROOT"' EXIT

copy_repo_subset() {
  cp "$ROOT_DIR/install.sh" "$TMP_ROOT/install.sh"
  cp "$ROOT_DIR/AGENTS.md" "$TMP_ROOT/AGENTS.md"
  cp "$ROOT_DIR/.gitignore" "$TMP_ROOT/.gitignore"
  cp -R "$ROOT_DIR/skills" "$TMP_ROOT/skills"
  cp -R "$ROOT_DIR/hooks" "$TMP_ROOT/hooks"
  cp -R "$ROOT_DIR/claude" "$TMP_ROOT/claude"
  cp -R "$ROOT_DIR/commands" "$TMP_ROOT/commands"
  cp -R "$ROOT_DIR/rules" "$TMP_ROOT/rules"
  cp -R "$ROOT_DIR/git-hooks" "$TMP_ROOT/git-hooks"
  cp -R "$ROOT_DIR/codex" "$TMP_ROOT/codex"
  cp -R "$ROOT_DIR/mcp" "$TMP_ROOT/mcp"
  cp -R "$ROOT_DIR/scripts" "$TMP_ROOT/scripts"
  cp -R "$ROOT_DIR/.claude-plugin" "$TMP_ROOT/.claude-plugin"
  cp -R "$ROOT_DIR/shell" "$TMP_ROOT/shell"
  chmod +x "$TMP_ROOT/install.sh"
  chmod +x "$TMP_ROOT/shell/goldband-self-update.sh" "$TMP_ROOT/shell/goldband-sync-skills.sh"
}

write_skill() {
  local dir="$1"
  local name="$2"
  mkdir -p "$dir"
  cat > "$dir/SKILL.md" <<EOF_SKILL
---
name: $name
description: test fixture
---
EOF_SKILL
}

create_fake_goldband_loop() {
  local loop_dir="$TMP_ROOT/goldband-loop"
  create_fake_loop_metadata "$loop_dir"
  write_fake_config_bin "$loop_dir"
  write_fake_repo_mode_bin "$loop_dir"
  write_fake_setup_script "$loop_dir"
}

create_fake_loop_metadata() {
  local loop_dir="$1"
  mkdir -p "$loop_dir/bin" "$loop_dir/review" "$loop_dir/.agents/skills"
  printf '0.0.0-test\n' > "$loop_dir/VERSION"
  write_skill "$loop_dir" "goldband"

  local skill
  for skill in investigate review qa ship browse goldband-upgrade; do
    local skill_name="goldband-$skill"
    [ "$skill" = "goldband-upgrade" ] && skill_name="goldband-upgrade"
    write_skill "$loop_dir/$skill" "$skill_name"
    write_skill "$loop_dir/.agents/skills/$skill_name" "$skill_name"
  done

  cat > "$loop_dir/review/checklist.md" <<'EOF_CHECKLIST'
# test checklist
EOF_CHECKLIST
  cat > "$loop_dir/review/shared-rubric.md" <<'EOF_SHARED'
# test shared rubric
EOF_SHARED
  cat > "$loop_dir/review/findings-schema.md" <<'EOF_SCHEMA'
# test findings schema
EOF_SCHEMA
  cat > "$loop_dir/review/ship-fix-first.md" <<'EOF_SHIP_FIX'
# test ship fix first
EOF_SHIP_FIX
  cat > "$loop_dir/review/greptile-triage.md" <<'EOF_GREPTILE'
# test greptile triage
EOF_GREPTILE
}

write_fake_config_bin() {
  local loop_dir="$1"
  cat > "$loop_dir/bin/goldband-config" <<'EOF_CONFIG'
#!/usr/bin/env bash
set -euo pipefail
STATE_DIR="${GOLDBAND_HOME:-$HOME/.goldband}"
CONFIG_FILE="$STATE_DIR/config.yaml"
case "${1:-}" in
  get)
    KEY="${2:?missing key}"
    grep -E "^${KEY}:" "$CONFIG_FILE" 2>/dev/null | tail -1 | awk '{print $2}' | tr -d '[:space:]' || true
    ;;
  set)
    KEY="${2:?missing key}"
    VALUE="${3:?missing value}"
    mkdir -p "$STATE_DIR"
    if grep -qE "^${KEY}:" "$CONFIG_FILE" 2>/dev/null; then
      perl -0pi -e "s/^${KEY}:.*/${KEY}: ${VALUE}/m" "$CONFIG_FILE"
    else
      echo "${KEY}: ${VALUE}" >> "$CONFIG_FILE"
    fi
    ;;
  list)
    cat "$CONFIG_FILE" 2>/dev/null || true
    ;;
  *)
    echo "Usage: goldband-config {get|set|list} [key] [value]" >&2
    exit 1
    ;;
esac
EOF_CONFIG
  chmod +x "$loop_dir/bin/goldband-config"
}

write_fake_repo_mode_bin() {
  local loop_dir="$1"
  cat > "$loop_dir/bin/goldband-repo-mode" <<'EOF_MODE'
#!/usr/bin/env bash
printf 'REPO_MODE=solo\n'
EOF_MODE
  chmod +x "$loop_dir/bin/goldband-repo-mode"
}

write_fake_setup_script() {
  local loop_dir="$1"
  write_fake_setup_header "$loop_dir"
  append_fake_setup_claude "$loop_dir"
  append_fake_setup_codex "$loop_dir"
  append_fake_setup_footer "$loop_dir"
  chmod +x "$loop_dir/setup"
}

write_fake_setup_header() {
  local loop_dir="$1"
  cat > "$loop_dir/setup" <<'EOF_SETUP'
#!/usr/bin/env bash
set -euo pipefail
HOST="claude"
PROFILE="standard"
while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --host=*) HOST="${1#--host=}"; shift ;;
    --profile) PROFILE="$2"; shift 2 ;;
    --profile=*) PROFILE="${1#--profile=}"; shift ;;
    *) shift ;;
  esac
done

ROOT="$(cd "$(dirname "$0")" && pwd)"
VERSION="$(cat "$ROOT/VERSION")"
mkdir -p "$HOME/.goldband/projects"
if [ "${FAIL_GOLDBAND_LOOP_SETUP:-0}" = "1" ]; then
  echo "forced setup failure" >&2
  exit 42
fi
EOF_SETUP
}

append_fake_setup_claude() {
  local loop_dir="$1"
  cat >> "$loop_dir/setup" <<'EOF_SETUP'
install_claude() {
  mkdir -p "$HOME/.claude/skills"
  rm -rf "$HOME/.claude/skills/goldband"
  if [ "$PROFILE" = "standard" ]; then
    mkdir -p "$HOME/.claude/skills/goldband/bin" "$HOME/.claude/skills/goldband/review" "$HOME/.claude/skills/goldband/workflows"
    ln -s "$ROOT/SKILL.md" "$HOME/.claude/skills/goldband/SKILL.md"
    ln -s "$ROOT/bin/goldband-config" "$HOME/.claude/skills/goldband/bin/goldband-config"
    ln -s "$ROOT/review/shared-rubric.md" "$HOME/.claude/skills/goldband/review/shared-rubric.md"
    ln -s "$ROOT/review/findings-schema.md" "$HOME/.claude/skills/goldband/review/findings-schema.md"
    ln -s "$ROOT/review/checklist.md" "$HOME/.claude/skills/goldband/review/checklist.md"
    ln -s "$ROOT/review/ship-fix-first.md" "$HOME/.claude/skills/goldband/review/ship-fix-first.md"
    ln -s "$ROOT/review/greptile-triage.md" "$HOME/.claude/skills/goldband/review/greptile-triage.md"
    for skill_dir in "$ROOT"/*; do
      [ -f "$skill_dir/SKILL.md" ] || continue
      skill_name="$(sed -n 's/^name:[[:space:]]*//p' "$skill_dir/SKILL.md" | head -1)"
      [ "$skill_name" = "goldband" ] && continue
      ln -s "$skill_dir/SKILL.md" "$HOME/.claude/skills/goldband/workflows/$skill_name.workflow.md"
      case "$skill_name" in
        goldband-*) ln -s "$skill_dir/SKILL.md" "$HOME/.claude/skills/goldband/workflows/${skill_name#goldband-}.workflow.md" ;;
      esac
    done
    for old in goldband-investigate goldband-review goldband-qa goldband-ship goldband-browse; do
      rm -rf "$HOME/.claude/skills/$old"
    done
  else
    ln -s "$ROOT" "$HOME/.claude/skills/goldband"
  fi
  if [ "$PROFILE" = "standard" ]; then
    rm -rf "$HOME/.claude/skills/goldband-upgrade"
    ln -s "$ROOT/goldband-upgrade" "$HOME/.claude/skills/goldband-upgrade"
  else
    for skill_dir in "$ROOT"/*; do
      [ -f "$skill_dir/SKILL.md" ] || continue
      skill_name="$(sed -n 's/^name:[[:space:]]*//p' "$skill_dir/SKILL.md" | head -1)"
      [ "$skill_name" = "goldband" ] && continue
      rm -rf "$HOME/.claude/skills/$skill_name"
      ln -s "$skill_dir" "$HOME/.claude/skills/$skill_name"
    done
  fi
  printf '%s\n' "$VERSION" > "$HOME/.claude/skills/goldband/.installed-version"
  mkdir -p "$HOME/.goldband/state"
  printf '%s\n' "$PROFILE" > "$HOME/.goldband/state/workflow-profile-claude"
}
EOF_SETUP
}

append_fake_setup_codex() {
  local loop_dir="$1"
  cat >> "$loop_dir/setup" <<'EOF_SETUP'
install_codex() {
  mkdir -p "$HOME/.codex/skills"
  rm -rf "$HOME/.codex/skills/goldband"
  mkdir -p "$HOME/.codex/skills/goldband/bin" "$HOME/.codex/skills/goldband/goldband-upgrade" "$HOME/.codex/skills/goldband/review" "$HOME/.codex/skills/goldband/workflows"
  cp "$ROOT/SKILL.md" "$HOME/.codex/skills/goldband/SKILL.md"
  ln -s "$ROOT/bin/goldband-config" "$HOME/.codex/skills/goldband/bin/goldband-config"
  ln -s "$ROOT/bin/goldband-repo-mode" "$HOME/.codex/skills/goldband/bin/goldband-repo-mode"
  ln -s "$ROOT/review/shared-rubric.md" "$HOME/.codex/skills/goldband/review/shared-rubric.md"
  ln -s "$ROOT/review/findings-schema.md" "$HOME/.codex/skills/goldband/review/findings-schema.md"
  ln -s "$ROOT/review/checklist.md" "$HOME/.codex/skills/goldband/review/checklist.md"
  ln -s "$ROOT/review/ship-fix-first.md" "$HOME/.codex/skills/goldband/review/ship-fix-first.md"
  ln -s "$ROOT/review/greptile-triage.md" "$HOME/.codex/skills/goldband/review/greptile-triage.md"
  printf '%s\n' "$VERSION" > "$HOME/.codex/skills/goldband/.installed-version"
  for skill_dir in "$ROOT/.agents/skills"/goldband-*; do
    [ -f "$skill_dir/SKILL.md" ] || continue
    skill_name="$(basename "$skill_dir")"
    ln -s "$skill_dir/SKILL.md" "$HOME/.codex/skills/goldband/workflows/$skill_name.workflow.md"
    ln -s "$skill_dir/SKILL.md" "$HOME/.codex/skills/goldband/workflows/${skill_name#goldband-}.workflow.md"
    if [ "$skill_name" = "goldband-upgrade" ]; then
      cp "$skill_dir/SKILL.md" "$HOME/.codex/skills/goldband/goldband-upgrade/SKILL.md"
      rm -rf "$HOME/.codex/skills/$skill_name"
      mkdir -p "$HOME/.codex/skills/$skill_name"
      cp "$skill_dir/SKILL.md" "$HOME/.codex/skills/$skill_name/SKILL.md"
    else
      rm -rf "$HOME/.codex/skills/$skill_name"
    fi
  done
  mkdir -p "$HOME/.goldband/state"
  printf '%s\n' "$PROFILE" > "$HOME/.goldband/state/workflow-profile-codex"
}
EOF_SETUP
}

append_fake_setup_footer() {
  local loop_dir="$1"
  cat >> "$loop_dir/setup" <<'EOF_SETUP'
case "$HOST" in
  claude) install_claude ;;
  codex) install_codex ;;
  auto) install_claude; install_codex ;;
  *) echo "unsupported host: $HOST" >&2; exit 1 ;;
esac
EOF_SETUP
}

assert_exists() {
  test -e "$1" || {
    echo "missing expected path: $1" >&2
    exit 1
  }
}

assert_absent() {
  if [ -e "$1" ] || [ -L "$1" ]; then
    echo "unexpected path exists: $1" >&2
    exit 1
  fi
}

assert_not_symlink() {
  if [ -L "$1" ]; then
    echo "unexpected symlink: $1" >&2
    exit 1
  fi
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  if ! printf '%s\n' "$haystack" | grep -q "$needle"; then
    echo "missing expected output: $needle" >&2
    printf '%s\n' "$haystack" >&2
    exit 1
  fi
}

assert_not_contains() {
  local haystack="$1"
  local needle="$2"
  if printf '%s\n' "$haystack" | grep -q "$needle"; then
    echo "unexpected output: $needle" >&2
    printf '%s\n' "$haystack" >&2
    exit 1
  fi
}

seed_old_workflow_entries() {
  mkdir -p \
    "$TMP_HOME/.claude/skills/workflow" \
    "$TMP_HOME/.codex/skills/workflow-old" \
    "$TMP_ROOT/.agents/skills/workflow/review"
}

plant_legacy_workflow_entries() {
  local home_dir="$1"
  local source_dir="$2"

  mkdir -p \
    "$home_dir/.claude/skills/goldband-review" \
    "$home_dir/.claude/skills/goldband-qa" \
    "$home_dir/.codex/skills/goldband-review" \
    "$home_dir/.codex/skills/goldband-qa"

  ln -s "$source_dir/review/SKILL.md" "$home_dir/.claude/skills/goldband-review/SKILL.md"
  ln -s "$source_dir/qa/SKILL.md" "$home_dir/.claude/skills/goldband-qa/SKILL.md"
  ln -s "$source_dir/review/SKILL.md" "$home_dir/.codex/skills/goldband-review/SKILL.md"
  ln -s "$source_dir/qa/SKILL.md" "$home_dir/.codex/skills/goldband-qa/SKILL.md"
}

write_fake_bun_bin() {
  local bin_dir="$1"
  mkdir -p "$bin_dir"
  cat > "$bin_dir/bun" <<'EOF_BUN'
#!/usr/bin/env bash
exit 0
EOF_BUN
  chmod +x "$bin_dir/bun"
}

write_noop_patch_names_bin() {
  local loop_dir="$1"
  cat > "$loop_dir/bin/goldband-patch-names" <<'EOF_PATCH'
#!/usr/bin/env bash
exit 0
EOF_PATCH
  chmod +x "$loop_dir/bin/goldband-patch-names"
}

create_minimal_real_setup_fixture() {
  local loop_dir="$1"
  mkdir -p "$loop_dir/bin" "$loop_dir/browse/dist" "$loop_dir/review"
  cp "$ROOT_DIR/goldband-loop/setup" "$loop_dir/setup"
  chmod +x "$loop_dir/setup"
  write_fake_config_bin "$loop_dir"
  write_noop_patch_names_bin "$loop_dir"
  cat > "$loop_dir/browse/dist/browse" <<'EOF_BROWSE'
#!/usr/bin/env bash
exit 0
EOF_BROWSE
  chmod +x "$loop_dir/browse/dist/browse"
  printf '0.0.0-test\n' > "$loop_dir/VERSION"
  write_skill "$loop_dir" "goldband"
  write_skill "$loop_dir/review" "goldband-review"
  write_skill "$loop_dir/qa" "goldband-qa"
  write_skill "$loop_dir/ship" "goldband-ship"
  write_skill "$loop_dir/goldband-upgrade" "goldband-upgrade"
  write_skill "$loop_dir/.agents/skills/goldband" "goldband"
  write_skill "$loop_dir/.agents/skills/goldband-review" "goldband-review"
  write_skill "$loop_dir/.agents/skills/goldband-qa" "goldband-qa"
  write_skill "$loop_dir/.agents/skills/goldband-upgrade" "goldband-upgrade"
  cat > "$loop_dir/review/checklist.md" <<'EOF_CHECKLIST'
# test checklist
EOF_CHECKLIST
  cat > "$loop_dir/review/shared-rubric.md" <<'EOF_SHARED'
# test shared rubric
EOF_SHARED
  cat > "$loop_dir/review/findings-schema.md" <<'EOF_SCHEMA'
# test findings schema
EOF_SCHEMA
  cat > "$loop_dir/review/ship-fix-first.md" <<'EOF_SHIP_FIX'
# test ship fix first
EOF_SHIP_FIX
  cat > "$loop_dir/review/design-checklist.md" <<'EOF_DESIGN'
# test design checklist
EOF_DESIGN
  cat > "$loop_dir/review/greptile-triage.md" <<'EOF_GREPTILE'
# test greptile triage
EOF_GREPTILE
  cat > "$loop_dir/review/TODOS-format.md" <<'EOF_TODOS'
# test todos format
EOF_TODOS
}

run_minimal_real_setup() {
  local home_dir="$1"
  local setup_path="$2"
  shift 2
  PATH="$TMP_ROOT/test-bin:$PATH" \
    HOME="$home_dir" \
    GOLDBAND_SKIP_BUILD=1 \
    GOLDBAND_SKIP_GENERATE=1 \
    GOLDBAND_SKIP_PLAYWRIGHT=1 \
    GOLDBAND_REQUIRE_PLAYWRIGHT=0 \
    GOLDBAND_SKIP_COREUTILS=1 \
    GOLDBAND_FORCE_COPY="${GOLDBAND_FORCE_COPY:-0}" \
    "$setup_path" "$@"
}

echo "[1/4] prepare fixture"
copy_repo_subset
create_fake_goldband_loop
seed_old_workflow_entries
mkdir -p "$TMP_HOME/.codex/prompts"
printf 'custom prompt\n' > "$TMP_HOME/.codex/prompts/custom.md"

echo "[2/4] installer smoke"
if HOME="$TMP_HOME" FAIL_GOLDBAND_LOOP_SETUP=1 "$TMP_ROOT/install.sh" workflow >/tmp/goldband-loop-fail.log 2>&1; then
  echo "expected failing setup to fail" >&2
  exit 1
fi
assert_exists "$TMP_HOME/.claude/skills/workflow"
assert_exists "$TMP_HOME/.codex/skills/workflow-old"
HOME="$TMP_HOME" "$TMP_ROOT/install.sh" workflow >/tmp/goldband-loop-claude.log
assert_exists "$TMP_HOME/.claude/commands/goldband.md"
HOME="$TMP_HOME" "$TMP_ROOT/install.sh" workflow-codex >/tmp/goldband-loop-codex.log
HOME="$TMP_HOME" "$TMP_ROOT/install.sh" all-with-workflow >/tmp/goldband-loop-all.log
HOME="$TMP_HOME" "$TMP_ROOT/install.sh" workflow-full >/tmp/goldband-loop-claude-legacy-full.log 2>&1
HOME="$TMP_HOME" "$TMP_ROOT/install.sh" workflow-codex-slim >/tmp/goldband-loop-codex-legacy-slim.log 2>&1
HOME="$TMP_HOME" "$TMP_ROOT/install.sh" workflow-auto-full >/tmp/goldband-loop-auto-legacy-full.log 2>&1
grep -q "已棄用" /tmp/goldband-loop-claude-legacy-full.log
grep -q "已棄用" /tmp/goldband-loop-codex-legacy-slim.log
grep -q "已棄用" /tmp/goldband-loop-auto-legacy-full.log

echo "[3/4] verify Goldband Loop entries"
assert_exists "$TMP_HOME/.goldband/projects"
assert_exists "$TMP_HOME/.claude/skills/goldband/SKILL.md"
assert_absent "$TMP_HOME/.claude/skills/_goldband-command"
assert_exists "$TMP_HOME/.codex/skills/goldband/SKILL.md"
assert_not_symlink "$TMP_HOME/.codex/skills/goldband/SKILL.md"
assert_exists "$TMP_HOME/.codex/skills/goldband/bin/goldband-config"
assert_exists "$TMP_HOME/.codex/skills/goldband/review/shared-rubric.md"
assert_exists "$TMP_HOME/.codex/skills/goldband/review/findings-schema.md"
assert_exists "$TMP_HOME/.codex/skills/goldband/review/checklist.md"
assert_exists "$TMP_HOME/.codex/skills/goldband/review/ship-fix-first.md"
assert_exists "$TMP_HOME/.codex/skills/goldband/review/greptile-triage.md"
assert_absent "$TMP_HOME/.claude/skills/goldband-investigate"
assert_absent "$TMP_HOME/.claude/skills/goldband-review"
assert_absent "$TMP_HOME/.claude/skills/goldband-qa"
assert_absent "$TMP_HOME/.claude/skills/goldband-ship"
assert_absent "$TMP_HOME/.codex/skills/goldband-review"
assert_absent "$TMP_HOME/.codex/skills/goldband-qa"
assert_absent "$TMP_HOME/.codex/skills/goldband-ship"
assert_exists "$TMP_HOME/.claude/skills/goldband-upgrade/SKILL.md"
assert_exists "$TMP_HOME/.codex/skills/goldband-upgrade/SKILL.md"
assert_not_symlink "$TMP_HOME/.codex/skills/goldband-upgrade/SKILL.md"
assert_not_symlink "$TMP_HOME/.codex/skills/goldband/goldband-upgrade/SKILL.md"
assert_exists "$TMP_HOME/.claude/skills/goldband/workflows/goldband-review.workflow.md"
assert_exists "$TMP_HOME/.codex/skills/goldband/workflows/goldband-review.workflow.md"
assert_exists "$TMP_HOME/.claude/commands/goldband.md"
assert_exists "$TMP_HOME/.codex/prompts/goldband.md"
assert_not_symlink "$TMP_HOME/.codex/prompts/goldband.md"
assert_exists "$TMP_HOME/.codex/prompts/custom.md"

assert_absent "$TMP_HOME/.claude/skills/workflow"
assert_absent "$TMP_HOME/.codex/skills/workflow"
assert_absent "$TMP_HOME/.codex/skills/workflow-old"
assert_absent "$TMP_ROOT/.agents/skills/workflow"
assert_absent "$TMP_HOME/.claude/commands/code-review.md"
assert_absent "$TMP_HOME/.claude/commands/checkpoint.md"
assert_absent "$TMP_HOME/.claude/commands/map-codebase.md"

echo "[3b/4] verify real setup standard guard and copy cleanup"
write_fake_bun_bin "$TMP_ROOT/test-bin"

SELF_HOME="$TMP_ROOT/self-home"
SELF_SOURCE="$SELF_HOME/.claude/skills/goldband"
create_minimal_real_setup_fixture "$SELF_SOURCE"
printf '%s\n' 'self-source sentinel' >> "$SELF_SOURCE/SKILL.md"
run_minimal_real_setup "$SELF_HOME" "$SELF_SOURCE/setup" --profile standard --quiet >/tmp/goldband-loop-self-standard.log
if [ -L "$SELF_SOURCE/SKILL.md" ]; then
  echo "self-source standard rewrote SKILL.md as a symlink" >&2
  exit 1
fi
grep -q 'self-source sentinel' "$SELF_SOURCE/SKILL.md"
assert_exists "$SELF_SOURCE/workflows/goldband-review.workflow.md"

COPY_HOME="$TMP_ROOT/copy-home"
COPY_SOURCE="$TMP_ROOT/copy-source/goldband-loop"
create_minimal_real_setup_fixture "$COPY_SOURCE"
plant_legacy_workflow_entries "$COPY_HOME" "$COPY_SOURCE"
mkdir -p "$COPY_HOME/.claude/skills/_goldband-command"
ln -s "$COPY_SOURCE/SKILL.md" "$COPY_HOME/.claude/skills/_goldband-command/SKILL.md"
printf 'source=%s\n' "$COPY_SOURCE" > "$COPY_HOME/.claude/skills/_goldband-command/.goldband-managed-skill"
GOLDBAND_FORCE_COPY=1 run_minimal_real_setup "$COPY_HOME" "$COPY_SOURCE/setup" --host claude --profile standard --quiet >/tmp/goldband-loop-copy-standard.log
assert_absent "$COPY_HOME/.claude/skills/_goldband-command"
assert_absent "$COPY_HOME/.claude/skills/goldband-review"
assert_absent "$COPY_HOME/.claude/skills/goldband-qa"
assert_absent "$COPY_HOME/.claude/skills/goldband-ship"
assert_exists "$COPY_HOME/.claude/skills/goldband-upgrade/SKILL.md"
assert_exists "$COPY_HOME/.claude/skills/goldband/workflows/goldband-review.workflow.md"

CODEX_LEGACY_HOME="$TMP_ROOT/codex-legacy-home"
CODEX_LEGACY_SOURCE="$TMP_ROOT/codex-legacy-source/goldband-loop"
create_minimal_real_setup_fixture "$CODEX_LEGACY_SOURCE"
plant_legacy_workflow_entries "$CODEX_LEGACY_HOME" "$CODEX_LEGACY_SOURCE"
run_minimal_real_setup "$CODEX_LEGACY_HOME" "$CODEX_LEGACY_SOURCE/setup" --host codex --profile standard --quiet >/tmp/goldband-loop-codex-legacy-cleanup.log
assert_absent "$CODEX_LEGACY_HOME/.codex/skills/goldband-review"
assert_absent "$CODEX_LEGACY_HOME/.codex/skills/goldband-qa"
assert_exists "$CODEX_LEGACY_HOME/.codex/skills/goldband-upgrade/SKILL.md"
assert_not_symlink "$CODEX_LEGACY_HOME/.codex/skills/goldband-upgrade/SKILL.md"
assert_not_symlink "$CODEX_LEGACY_HOME/.codex/skills/goldband/goldband-upgrade/SKILL.md"
assert_exists "$CODEX_LEGACY_HOME/.codex/skills/goldband/workflows/goldband-review.workflow.md"

PROMPT_LEGACY_HOME="$TMP_ROOT/prompt-legacy-home"
mkdir -p "$PROMPT_LEGACY_HOME/.codex"
ln -s "$TMP_ROOT/codex/prompts" "$PROMPT_LEGACY_HOME/.codex/prompts"
HOME="$PROMPT_LEGACY_HOME" "$TMP_ROOT/install.sh" codex-prompts >/tmp/goldband-loop-codex-prompts-legacy.log
if [ -L "$PROMPT_LEGACY_HOME/.codex/prompts" ]; then
  echo "legacy codex prompts directory symlink was not migrated" >&2
  exit 1
fi
assert_exists "$PROMPT_LEGACY_HOME/.codex/prompts/goldband.md"

LEGACY_ENV_HOME="$TMP_ROOT/legacy-env-home"
LEGACY_ENV_SOURCE="$TMP_ROOT/legacy-env-source/goldband-loop"
create_minimal_real_setup_fixture "$LEGACY_ENV_SOURCE"
GOLDBAND_WORKFLOW_PROFILE=full run_minimal_real_setup "$LEGACY_ENV_HOME" "$LEGACY_ENV_SOURCE/setup" --host codex --quiet >/tmp/goldband-loop-legacy-env-full.log
assert_contains "$(cat "$LEGACY_ENV_HOME/.goldband/state/workflow-profile-codex")" "standard"

LEGACY_FLAG_HOME="$TMP_ROOT/legacy-flag-home"
LEGACY_FLAG_SOURCE="$TMP_ROOT/legacy-flag-source/goldband-loop"
create_minimal_real_setup_fixture "$LEGACY_FLAG_SOURCE"
run_minimal_real_setup "$LEGACY_FLAG_HOME" "$LEGACY_FLAG_SOURCE/setup" --host claude --profile slim --quiet >/tmp/goldband-loop-legacy-flag-slim.log
assert_contains "$(cat "$LEGACY_FLAG_HOME/.goldband/state/workflow-profile-claude")" "standard"

COUNT_HOME="$TMP_ROOT/count-home"
COUNT_SOURCE="$TMP_ROOT/count-source/goldband-loop"
create_minimal_real_setup_fixture "$COUNT_SOURCE"
write_skill "$COUNT_HOME/.claude/skills/external-tool" "external-tool"
run_minimal_real_setup "$COUNT_HOME" "$COUNT_SOURCE/setup" --profile standard --no-prefix --quiet >/tmp/goldband-loop-count-standard.log
COUNT_STATUS="$(HOME="$COUNT_HOME" "$TMP_ROOT/install.sh" status)"
assert_contains "$COUNT_STATUS" "Goldband Loop Claude workflow profile: standard (2 exposed skills, 0 top-level workflows)"

STATUS_ALIAS_HOME="$TMP_ROOT/status-alias-home"
mkdir -p "$STATUS_ALIAS_HOME/.claude/skills/goldband" "$STATUS_ALIAS_HOME/.claude/skills/_goldband-command"
printf '%s\n' '---' 'name: goldband' '---' > "$STATUS_ALIAS_HOME/.claude/skills/goldband/SKILL.md"
ln -s "$STATUS_ALIAS_HOME/.claude/skills/goldband/SKILL.md" "$STATUS_ALIAS_HOME/.claude/skills/_goldband-command/SKILL.md"
STATUS_ALIAS_OUTPUT="$(HOME="$STATUS_ALIAS_HOME" "$TMP_ROOT/install.sh" status 2>&1 || true)"
assert_contains "$STATUS_ALIAS_OUTPUT" "legacy /goldband skill alias"
assert_not_contains "$STATUS_ALIAS_OUTPUT" "command not found"

echo "[4/4] status output"
STATUS_OUTPUT="$(HOME="$TMP_HOME" "$TMP_ROOT/install.sh" status)"
assert_contains "$STATUS_OUTPUT" "codex prompt goldband.md"
assert_contains "$STATUS_OUTPUT" "Goldband Loop Claude runtime (0.0.0-test)"
assert_contains "$STATUS_OUTPUT" "Goldband Loop Codex runtime (0.0.0-test)"
assert_contains "$STATUS_OUTPUT" "Goldband Loop Claude workflow profile: standard"
assert_contains "$STATUS_OUTPUT" "Goldband Loop Codex workflow profile: standard"
assert_contains "$STATUS_OUTPUT" "Goldband Loop state dir (~/.goldband/projects)"

CODEX_REQUIREMENTS_FILE="$TMP_ROOT/etc/codex/requirements.toml" HOME="$TMP_HOME" "$TMP_ROOT/install.sh" uninstall >/tmp/goldband-loop-uninstall.log
assert_absent "$TMP_HOME/.codex/prompts/goldband.md"
assert_exists "$TMP_HOME/.codex/prompts/custom.md"

echo "[OK] Goldband Loop installer integration smoke test passed"
