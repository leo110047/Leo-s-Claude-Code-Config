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
    write_skill "$loop_dir/$skill" "goldband-$skill"
    write_skill "$loop_dir/.agents/skills/goldband-$skill" "goldband-$skill"
  done

  cat > "$loop_dir/review/checklist.md" <<'EOF_CHECKLIST'
# test checklist
EOF_CHECKLIST
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
while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --host=*) HOST="${1#--host=}"; shift ;;
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
  ln -s "$ROOT" "$HOME/.claude/skills/goldband"
  rm -rf "$HOME/.claude/skills/_goldband-command"
  mkdir -p "$HOME/.claude/skills/_goldband-command"
  ln -s "$ROOT/SKILL.md" "$HOME/.claude/skills/_goldband-command/SKILL.md"
  for skill_dir in "$ROOT"/*; do
    [ -f "$skill_dir/SKILL.md" ] || continue
    skill_name="$(sed -n 's/^name:[[:space:]]*//p' "$skill_dir/SKILL.md" | head -1)"
    [ "$skill_name" = "goldband" ] && continue
    rm -rf "$HOME/.claude/skills/$skill_name"
    ln -s "$skill_dir" "$HOME/.claude/skills/$skill_name"
  done
  printf '%s\n' "$VERSION" > "$HOME/.claude/skills/goldband/.installed-version"
}
EOF_SETUP
}

append_fake_setup_codex() {
  local loop_dir="$1"
  cat >> "$loop_dir/setup" <<'EOF_SETUP'
install_codex() {
  mkdir -p "$HOME/.codex/skills"
  rm -rf "$HOME/.codex/skills/goldband"
  mkdir -p "$HOME/.codex/skills/goldband/bin" "$HOME/.codex/skills/goldband/review"
  ln -s "$ROOT/SKILL.md" "$HOME/.codex/skills/goldband/SKILL.md"
  ln -s "$ROOT/bin/goldband-config" "$HOME/.codex/skills/goldband/bin/goldband-config"
  ln -s "$ROOT/bin/goldband-repo-mode" "$HOME/.codex/skills/goldband/bin/goldband-repo-mode"
  ln -s "$ROOT/review/checklist.md" "$HOME/.codex/skills/goldband/review/checklist.md"
  ln -s "$ROOT/review/greptile-triage.md" "$HOME/.codex/skills/goldband/review/greptile-triage.md"
  printf '%s\n' "$VERSION" > "$HOME/.codex/skills/goldband/.installed-version"
  for skill_dir in "$ROOT/.agents/skills"/goldband-*; do
    [ -f "$skill_dir/SKILL.md" ] || continue
    skill_name="$(basename "$skill_dir")"
    rm -rf "$HOME/.codex/skills/$skill_name"
    ln -s "$skill_dir" "$HOME/.codex/skills/$skill_name"
  done
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

assert_contains() {
  local haystack="$1"
  local needle="$2"
  if ! printf '%s\n' "$haystack" | grep -q "$needle"; then
    echo "missing expected output: $needle" >&2
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

echo "[1/4] prepare fixture"
copy_repo_subset
create_fake_goldband_loop
seed_old_workflow_entries

echo "[2/4] installer smoke"
if HOME="$TMP_HOME" FAIL_GOLDBAND_LOOP_SETUP=1 "$TMP_ROOT/install.sh" workflow >/tmp/goldband-loop-fail.log 2>&1; then
  echo "expected failing setup to fail" >&2
  exit 1
fi
assert_exists "$TMP_HOME/.claude/skills/workflow"
assert_exists "$TMP_HOME/.codex/skills/workflow-old"
HOME="$TMP_HOME" "$TMP_ROOT/install.sh" workflow >/tmp/goldband-loop-claude.log
HOME="$TMP_HOME" "$TMP_ROOT/install.sh" workflow-codex >/tmp/goldband-loop-codex.log
HOME="$TMP_HOME" "$TMP_ROOT/install.sh" all-with-workflow >/tmp/goldband-loop-all.log

echo "[3/4] verify Goldband Loop entries"
assert_exists "$TMP_HOME/.goldband/projects"
assert_exists "$TMP_HOME/.claude/skills/goldband/SKILL.md"
assert_exists "$TMP_HOME/.claude/skills/_goldband-command/SKILL.md"
assert_exists "$TMP_HOME/.claude/skills/goldband-investigate/SKILL.md"
assert_exists "$TMP_HOME/.claude/skills/goldband-review/SKILL.md"
assert_exists "$TMP_HOME/.claude/skills/goldband-qa/SKILL.md"
assert_exists "$TMP_HOME/.claude/skills/goldband-ship/SKILL.md"
assert_exists "$TMP_HOME/.claude/skills/goldband-browse/SKILL.md"
assert_exists "$TMP_HOME/.codex/skills/goldband/SKILL.md"
assert_exists "$TMP_HOME/.codex/skills/goldband/bin/goldband-config"
assert_exists "$TMP_HOME/.codex/skills/goldband/review/checklist.md"
assert_exists "$TMP_HOME/.codex/skills/goldband/review/greptile-triage.md"
assert_exists "$TMP_HOME/.codex/skills/goldband-review/SKILL.md"
assert_exists "$TMP_HOME/.codex/skills/goldband-qa/SKILL.md"
assert_exists "$TMP_HOME/.codex/skills/goldband-ship/SKILL.md"
grep -q '^name: goldband-investigate$' "$TMP_HOME/.claude/skills/goldband-investigate/SKILL.md"
grep -q '^name: goldband-review$' "$TMP_HOME/.codex/skills/goldband-review/SKILL.md"

assert_absent "$TMP_HOME/.claude/skills/workflow"
assert_absent "$TMP_HOME/.codex/skills/workflow"
assert_absent "$TMP_HOME/.codex/skills/workflow-old"
assert_absent "$TMP_ROOT/.agents/skills/workflow"
assert_absent "$TMP_HOME/.claude/commands/code-review.md"
assert_absent "$TMP_HOME/.claude/commands/checkpoint.md"
assert_absent "$TMP_HOME/.claude/commands/map-codebase.md"

echo "[4/4] status output"
STATUS_OUTPUT="$(HOME="$TMP_HOME" "$TMP_ROOT/install.sh" status)"
assert_contains "$STATUS_OUTPUT" "Goldband Loop Claude runtime (0.0.0-test)"
assert_contains "$STATUS_OUTPUT" "Goldband Loop Codex runtime (0.0.0-test)"
assert_contains "$STATUS_OUTPUT" "Goldband Loop state dir (~/.goldband/projects)"

echo "[OK] Goldband Loop installer integration smoke test passed"
