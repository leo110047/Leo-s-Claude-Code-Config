#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_HOME="$(mktemp -d /tmp/goldband-workflow-home.XXXXXX)"
TMP_WORKFLOW="$(mktemp -d /tmp/goldband-workflow-repo.XXXXXX)"
TMP_ROOT="$(mktemp -d /tmp/goldband-workflow-root.XXXXXX)"
TMP_EMPTY_HOME="$(mktemp -d /tmp/goldband-empty-home.XXXXXX)"
TMP_EMPTY_ROOT="$(mktemp -d /tmp/goldband-empty-root.XXXXXX)"
TMP_UPDATE_ORIGIN="$(mktemp -d /tmp/goldband-update-origin.XXXXXX)"
TMP_UPDATE_SEED="$(mktemp -d /tmp/goldband-update-seed.XXXXXX)"
TMP_UPDATE_WORK="$(mktemp -d /tmp/goldband-update-work.XXXXXX)"
LEGACY_RUNTIME_NAME="g""stack"
LEGACY_GOLDBAND_UPGRADE="goldband-${LEGACY_RUNTIME_NAME}-upgrade"
trap 'rm -rf "$TMP_HOME" "$TMP_WORKFLOW" "$TMP_ROOT" "$TMP_EMPTY_HOME" "$TMP_EMPTY_ROOT" "$TMP_UPDATE_ORIGIN" "$TMP_UPDATE_SEED" "$TMP_UPDATE_WORK"' EXIT

mkdir -p \
  "$TMP_WORKFLOW/bin" \
  "$TMP_WORKFLOW/careful" \
  "$TMP_WORKFLOW/freeze" \
  "$TMP_WORKFLOW/investigate" \
  "$TMP_WORKFLOW/review" \
  "$TMP_WORKFLOW/qa" \
  "$TMP_WORKFLOW/ship" \
  "$TMP_WORKFLOW/browse"

. "$ROOT_DIR/shell/install/workflow-wrapper-aliases.sh"

cat > "$TMP_ROOT/harden-wrapper.md" <<'EOF'
[ -n "$_ROOT" ]&&[ -d "$_ROOT/.agents/skills/workflow" ]&&WORKFLOW_ROOT="$_ROOT/.agents/skills/workflow"
EOF
harden_goldband_wrapper_repo_runtime_detection "$TMP_ROOT/harden-wrapper.md"
grep -q '\.agents/skills/workflow/bin/workflow-config' "$TMP_ROOT/harden-wrapper.md"
if grep -Eq '\[[[:space:]]+-d[[:space:]]+"?\$_ROOT/\.agents/skills/workflow' "$TMP_ROOT/harden-wrapper.md"; then
  exit 1
fi

cat > "$TMP_ROOT/harden-wrapper-unsafe.md" <<'EOF'
test -d "$_ROOT/.agents/skills/workflow" && WORKFLOW_ROOT="$_ROOT/.agents/skills/workflow"
EOF
if harden_goldband_wrapper_repo_runtime_detection "$TMP_ROOT/harden-wrapper-unsafe.md" 2>/dev/null; then
  exit 1
fi

cat > "$TMP_WORKFLOW/VERSION" <<'EOF'
0.0.0-test
EOF

cat > "$TMP_WORKFLOW/SKILL.md" <<'EOF'
---
name: workflow
description: test fixture
---
EOF

for skill in careful freeze investigate review qa ship browse; do
  cat > "$TMP_WORKFLOW/$skill/SKILL.md" <<EOF
---
name: $skill
description: test fixture
---
$(if [ "$skill" = "investigate" ]; then cat <<'SKILL_BODY'
```bash
WORKFLOW_BIN="$HOME/.codex/skills/workflow/bin"
_PROACTIVE=$($WORKFLOW_BIN/workflow-config get proactive 2>/dev/null || echo "true")
source <(~/.claude/skills/workflow/bin/workflow-repo-mode 2>/dev/null) || true
```
SKILL_BODY
fi)
$(if [ "$skill" = "review" ]; then cat <<'SKILL_BODY'
Read `.claude/skills/review/checklist.md`.
Read `.agents/skills/workflow/review/checklist.md`.
SKILL_BODY
fi)
EOF
done

cat > "$TMP_WORKFLOW/review/checklist.md" <<'EOF'
# test checklist
EOF

mkdir -p "$TMP_WORKFLOW/review/specialists"
cat > "$TMP_WORKFLOW/review/specialists/security.md" <<'EOF'
# test specialist
EOF

cat > "$TMP_WORKFLOW/bin/workflow-repo-mode" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$TMP_WORKFLOW/bin/workflow-repo-mode"

cat > "$TMP_WORKFLOW/bin/workflow-config" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
STATE_DIR="${WORKFLOW_STATE_DIR:-$HOME/.workflow}"
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
      sed -i '' "s/^${KEY}:.*/${KEY}: ${VALUE}/" "$CONFIG_FILE"
    else
      echo "${KEY}: ${VALUE}" >> "$CONFIG_FILE"
    fi
    ;;
  list)
    cat "$CONFIG_FILE" 2>/dev/null || true
    ;;
  *)
    echo "Usage: workflow-config {get|set|list} [key] [value]" >&2
    exit 1
    ;;
esac
EOF
chmod +x "$TMP_WORKFLOW/bin/workflow-config"

cat > "$TMP_WORKFLOW/setup" <<'EOF'
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

if [ -n "${GOLDBAND_TEST_WORKFLOW_SETUP_DELAY:-}" ]; then
  echo "fixture workflow setup started: $HOST"
  sleep "$GOLDBAND_TEST_WORKFLOW_SETUP_DELAY"
fi

ROOT="$(cd "$(dirname "$0")" && pwd)"
VERSION="$(cat "$ROOT/VERSION")"
mkdir -p "$HOME/.workflow/projects"
if [ "${GOLDBAND_TEST_CREATE_VENDOR_SKILL:-0}" = "1" ]; then
  mkdir -p "$ROOT/future-upstream"
  cat > "$ROOT/future-upstream/SKILL.md" <<'SKILL'
---
name: future-upstream
description: generated during setup
---
SKILL
fi

install_claude() {
  mkdir -p "$HOME/.claude/skills"
  rm -rf "$HOME/.claude/skills/workflow"
  ln -s "$ROOT" "$HOME/.claude/skills/workflow"
}

install_codex() {
  mkdir -p "$HOME/.codex/skills"
  rm -rf "$HOME/.codex/skills/workflow"
  ln -s "$ROOT" "$HOME/.codex/skills/workflow"
  for skill in investigate review qa ship careful freeze claude; do
    target="$HOME/.codex/skills/workflow-$skill"
    rm -rf "$target"
    mkdir -p "$target"
    cat > "$target/SKILL.md" <<SKILL
---
name: workflow-$skill
description: generated test fixture
---
$(if [ "$skill" = "investigate" ]; then cat <<'SKILL_BODY'
```bash
WORKFLOW_ROOT="$HOME/.codex/skills/workflow"
[ -n "$_ROOT" ] && [ -d "$_ROOT/.agents/skills/workflow" ] && WORKFLOW_ROOT="$_ROOT/.agents/skills/workflow"
WORKFLOW_BIN="$WORKFLOW_ROOT/bin"
_PROACTIVE=$($WORKFLOW_BIN/workflow-config get proactive 2>/dev/null || echo "true")
```
SKILL_BODY
fi)
$(if [ "$skill" = "review" ]; then cat <<'SKILL_BODY'
Read `.agents/skills/workflow/review/checklist.md`.
SKILL_BODY
fi)
SKILL
  done
  printf '%s\n' "$VERSION" > "$HOME/.codex/skills/workflow/.installed-version"
}

case "$HOST" in
  claude)
    install_claude
    ;;
  codex)
    install_codex
    ;;
  auto)
    install_claude
    install_codex
    ;;
  *)
    echo "unsupported host: $HOST" >&2
    exit 1
    ;;
esac
EOF
chmod +x "$TMP_WORKFLOW/setup"

mkdir -p "$TMP_ROOT/vendor"
cp "$ROOT_DIR/install.sh" "$TMP_ROOT/install.sh"
cp "$ROOT_DIR/AGENTS.md" "$TMP_ROOT/AGENTS.md"
cp "$ROOT_DIR/.gitignore" "$TMP_ROOT/.gitignore"
cp -R "$ROOT_DIR/skills" "$TMP_ROOT/skills"
cp -R "$ROOT_DIR/hooks" "$TMP_ROOT/hooks"
cp -R "$ROOT_DIR/claude" "$TMP_ROOT/claude"
cp -R "$ROOT_DIR/commands" "$TMP_ROOT/commands"
cp -R "$ROOT_DIR/contexts" "$TMP_ROOT/contexts"
cp -R "$ROOT_DIR/rules" "$TMP_ROOT/rules"
cp -R "$ROOT_DIR/git-hooks" "$TMP_ROOT/git-hooks"
cp -R "$ROOT_DIR/codex" "$TMP_ROOT/codex"
cp -R "$ROOT_DIR/mcp" "$TMP_ROOT/mcp"
cp -R "$ROOT_DIR/scripts" "$TMP_ROOT/scripts"
cp -R "$ROOT_DIR/.claude-plugin" "$TMP_ROOT/.claude-plugin"
cp -R "$ROOT_DIR/shell" "$TMP_ROOT/shell"
cp -R "$TMP_WORKFLOW" "$TMP_ROOT/vendor/workflow"
chmod +x "$TMP_ROOT/install.sh"
chmod +x "$TMP_ROOT/shell/goldband-self-update.sh" "$TMP_ROOT/shell/goldband-sync-skills.sh"

allow_file_copy_fallback() {
    command -v cygpath >/dev/null 2>&1 && command -v cmd >/dev/null 2>&1
}

assert_link_or_file_copy() {
    local installed="$1"
    local source="$2"
    if [ -L "$installed" ]; then
        test "$(readlink "$installed")" = "$source"
        return
    fi
    if ! allow_file_copy_fallback; then
        echo "expected symlink outside Windows fallback path: $installed" >&2
        exit 1
    fi
    test -f "$installed"
    cmp -s "$source" "$installed"
}

normalize_test_path() {
    if command -v cygpath >/dev/null 2>&1; then
        cygpath -m "$1" 2>/dev/null && return
    fi
    printf '%s\n' "$1"
}

assert_same_path() {
    test "$(normalize_test_path "$1")" = "$(normalize_test_path "$2")"
}

assert_directory_repo_link() {
    local installed="$1"
    local source="$2"
    test -L "$installed"
    test -d "$installed"
    assert_same_path "$(readlink "$installed")" "$source"
}

test_windows_junction_detection() {
    allow_file_copy_fallback || return 0
    local fixture_dir
    fixture_dir="$(mktemp -d)"
    mkdir -p "$fixture_dir/src"
    # shellcheck source=/dev/null
    . "$TMP_ROOT/shell/install/common.sh"
    create_windows_directory_junction "$fixture_dir/src" "$fixture_dir/dest"
    assert_directory_repo_link "$fixture_dir/dest" "$fixture_dir/src"
    repo_path_installed_from "$fixture_dir/src" "$fixture_dir/dest"
    rm -rf "$fixture_dir"
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

echo "[1/8] skill and Codex hook checks"
"$ROOT_DIR/scripts/check-skills.sh"
node "$ROOT_DIR/scripts/test-codex-hook-router.mjs"
node "$ROOT_DIR/scripts/test-telemetry.mjs"
test_windows_junction_detection

echo "[2/8] installer smoke"
HOME="$TMP_HOME" "$TMP_ROOT/install.sh" workflow >/tmp/goldband-workflow-install.log
HOME="$TMP_HOME" "$TMP_ROOT/install.sh" workflow-codex >/tmp/goldband-workflow-codex.log
HOME="$TMP_HOME" "$TMP_ROOT/install.sh" all-with-workflow >/tmp/goldband-all-with-workflow.log
CODEX_REQUIREMENTS_FILE="$TMP_HOME/.codex/requirements.toml" HOME="$TMP_HOME" "$TMP_ROOT/install.sh" codex-requirements >/tmp/goldband-codex-requirements.log
GOLDBAND_TEST_CREATE_VENDOR_SKILL=1 HOME="$TMP_HOME" "$TMP_ROOT/install.sh" workflow-auto >/tmp/goldband-workflow-vendor-restore.log
test ! -e "$TMP_ROOT/vendor/workflow/future-upstream/SKILL.md"

echo "[3/8] workflow setup output streams while running"
STREAM_LOG="/tmp/goldband-workflow-stream.log"
GOLDBAND_TEST_WORKFLOW_SETUP_DELAY=2 HOME="$TMP_HOME" "$TMP_ROOT/install.sh" workflow-auto >"$STREAM_LOG" 2>&1 &
stream_pid=$!
stream_seen=0
stream_deadline=$((SECONDS + 10))
while [ "$SECONDS" -lt "$stream_deadline" ]; do
    if grep -q "fixture workflow setup started: auto" "$STREAM_LOG"; then
        stream_seen=1
        break
    fi
    sleep 0.2
done
if [ "$stream_seen" -ne 1 ]; then
    kill "$stream_pid" 2>/dev/null || true
    wait "$stream_pid" 2>/dev/null || true
    echo "workflow setup output did not stream before completion" >&2
    exit 1
fi
wait "$stream_pid"

echo "[4/8] verify symlinks"
test -d "$TMP_HOME/.claude/skills/workflow"
test -d "$TMP_HOME/.codex/skills/workflow"
test -d "$TMP_HOME/.workflow/projects"
test -f "$TMP_HOME/.codex/skills/workflow/VERSION"
assert_directory_repo_link "$TMP_HOME/.claude/commands" "$TMP_ROOT/commands"
assert_directory_repo_link "$TMP_HOME/.claude/contexts" "$TMP_ROOT/contexts"
assert_directory_repo_link "$TMP_HOME/.claude/rules" "$TMP_ROOT/rules"
assert_directory_repo_link "$TMP_HOME/.claude/hooks/scripts" "$TMP_ROOT/hooks/scripts"
assert_link_or_file_copy "$TMP_HOME/.claude/statusline-command.sh" "$TMP_ROOT/hooks/statusline-command.sh"
test -f "$TMP_HOME/.codex/config.toml"
grep -q '^# Generated by goldband Codex config installer$' "$TMP_HOME/.codex/config.toml"
assert_link_or_file_copy "$TMP_HOME/.codex/readonly.config.toml" "$TMP_ROOT/codex/profiles/readonly.config.toml"
assert_link_or_file_copy "$TMP_HOME/.codex/release.config.toml" "$TMP_ROOT/codex/profiles/release.config.toml"
assert_link_or_file_copy "$TMP_HOME/.codex/auto_review_experiment.config.toml" "$TMP_ROOT/codex/profiles/auto_review_experiment.config.toml"
test -f "$TMP_HOME/.codex/requirements.toml"
assert_link_or_file_copy "$TMP_HOME/.claude/CLAUDE.md" "$TMP_ROOT/claude/CLAUDE.md"
assert_link_or_file_copy "$TMP_HOME/.codex/AGENTS.md" "$TMP_ROOT/codex/AGENTS.md"
test -d "$TMP_HOME/.codex/rules"
assert_link_or_file_copy "$TMP_HOME/.codex/rules/default.rules" "$TMP_ROOT/codex/local/rules/default.rules"
assert_link_or_file_copy "$TMP_HOME/.codex/rules/goldband.rules" "$TMP_ROOT/codex/rules/default.rules"
assert_link_or_file_copy "$TMP_HOME/.claude/bin/goldband-self-update" "$TMP_ROOT/shell/goldband-self-update.sh"
assert_link_or_file_copy "$TMP_HOME/.claude/shell/goldband-launchers.sh" "$TMP_ROOT/shell/goldband-launchers.sh"
test -z "$(HOME="$TMP_HOME" git config --global --get core.hooksPath 2>/dev/null || true)"
HOME="$TMP_HOME" "$TMP_ROOT/install.sh" style-gate >/tmp/goldband-style-gate-install.log
assert_same_path "$(HOME="$TMP_HOME" git config --global --get core.hooksPath)" "$TMP_ROOT/git-hooks"
test -x "$TMP_ROOT/git-hooks/pre-commit"
test -x "$TMP_ROOT/git-hooks/commit-msg"
test ! -e "$TMP_HOME/.claude/skills/workflow/SKILL.md"
test ! -e "$TMP_HOME/.codex/skills/workflow/SKILL.md"
test -e "$TMP_HOME/.claude/skills/workflow/freeze"
test -e "$TMP_HOME/.claude/skills/workflow/bin/workflow-repo-mode"
test -e "$TMP_HOME/.codex/skills/workflow/review"
test -f "$TMP_ROOT/.agents/skills/workflow/review/checklist.md"
if [ -L "$TMP_ROOT/.agents/skills/workflow/review/checklist.md" ]; then
  test "$(readlink "$TMP_ROOT/.agents/skills/workflow/review/checklist.md")" = "../../../../vendor/workflow/review/checklist.md"
else
  allow_file_copy_fallback
  cmp -s "$TMP_ROOT/vendor/workflow/review/checklist.md" "$TMP_ROOT/.agents/skills/workflow/review/checklist.md"
fi
test -f "$TMP_ROOT/.agents/skills/workflow/review/specialists/security.md"
if [ -L "$TMP_ROOT/.agents/skills/workflow/review/specialists" ]; then
  test "$(readlink "$TMP_ROOT/.agents/skills/workflow/review/specialists")" = "../../../../vendor/workflow/review/specialists"
else
  allow_file_copy_fallback
  cmp -s "$TMP_ROOT/vendor/workflow/review/specialists/security.md" "$TMP_ROOT/.agents/skills/workflow/review/specialists/security.md"
fi
git -C "$TMP_ROOT" init -q
git -C "$TMP_ROOT" check-ignore -q ".agents/skills/workflow/review/checklist.md"
test -e "$TMP_HOME/.codex/skills/workflow/bin/workflow-config"
test -f "$TMP_HOME/.claude/skills/goldband-investigate/SKILL.md"
test -f "$TMP_HOME/.claude/skills/goldband-review/SKILL.md"
test -f "$TMP_HOME/.claude/skills/goldband-qa/SKILL.md"
test -f "$TMP_HOME/.claude/skills/goldband-ship/SKILL.md"
test -f "$TMP_HOME/.claude/skills/goldband-browse/SKILL.md"
test -f "$TMP_HOME/.codex/skills/goldband-investigate/SKILL.md"
test -f "$TMP_HOME/.codex/skills/goldband-review/SKILL.md"
test -f "$TMP_HOME/.codex/skills/goldband-qa/SKILL.md"
test -f "$TMP_HOME/.codex/skills/goldband-ship/SKILL.md"
test -f "$TMP_HOME/.codex/skills/goldband-claude/SKILL.md"
test -f "$TMP_HOME/.claude/skills/goldband-review/review/checklist.md"
test -f "$TMP_HOME/.codex/skills/goldband-review/review/checklist.md"
test -f "$TMP_HOME/.claude/commands/goldband-language.md"
test -f "$TMP_HOME/.claude/commands/scripts/set-goldband-language.sh"
grep -q '^# >>> goldband shell launchers >>>$' "$TMP_HOME/.zshrc"
grep -q 'source "\$HOME/.claude/shell/goldband-launchers.sh"' "$TMP_HOME/.zshrc"
if command -v jq >/dev/null 2>&1; then
    if jq -e --slurpfile retired "$TMP_ROOT/hooks/claude-retired-permission-allow.json" '
        (.permissions.allow // []) as $allow
        | any($retired[0][]; . as $entry | $allow | index($entry))
    ' "$TMP_HOME/.claude/settings.json" >/dev/null; then
        echo "retired broad Claude permission allow patterns should not be installed" >&2
        exit 1
    fi
    EXPECTED_HOOK_COUNT="$(jq '[.hooks[] | length] | add' "$TMP_ROOT/hooks/hooks.json")"
    jq '.hooks.SessionStart += [{"hooks":[{"type":"command","command":"node \"'"$TMP_HOME"'/.claude/hooks/scripts/hooks/hook-router.js\"","timeout":5}]}]' \
      "$TMP_HOME/.claude/settings.json" > "$TMP_HOME/.claude/settings.json.tmp"
    mv "$TMP_HOME/.claude/settings.json.tmp" "$TMP_HOME/.claude/settings.json"
    HOME="$TMP_HOME" "$TMP_ROOT/install.sh" hooks >/tmp/goldband-hooks-dedup.log
    ACTUAL_HOOK_COUNT="$(jq '[.hooks[] | length] | add' "$TMP_HOME/.claude/settings.json")"
    test "$ACTUAL_HOOK_COUNT" = "$EXPECTED_HOOK_COUNT"
else
    grep -q 'jq 未安裝' /tmp/goldband-all-with-workflow.log
fi
test ! -e "$TMP_HOME/.claude/skills/review"
test ! -e "$TMP_HOME/.claude/skills/goldband-upgrade"
test ! -e "$TMP_HOME/.codex/skills/workflow-review"
test ! -e "$TMP_HOME/.codex/skills/goldband-upgrade"
test ! -e "$TMP_HOME/.codex/skills/$LEGACY_RUNTIME_NAME"
test ! -e "$TMP_HOME/.codex/skills/$LEGACY_GOLDBAND_UPGRADE"
test "$(readlink "$TMP_HOME/.claude/commands")" = "$TMP_ROOT/commands"
grep -q '^name: goldband-investigate$' "$TMP_HOME/.claude/skills/goldband-investigate/SKILL.md"
grep -q '^name: goldband-review$' "$TMP_HOME/.claude/skills/goldband-review/SKILL.md"
grep -q '^name: goldband-qa$' "$TMP_HOME/.claude/skills/goldband-qa/SKILL.md"
grep -q '^name: goldband-ship$' "$TMP_HOME/.claude/skills/goldband-ship/SKILL.md"
grep -q '^name: goldband-browse$' "$TMP_HOME/.claude/skills/goldband-browse/SKILL.md"
grep -q '^name: goldband-investigate$' "$TMP_HOME/.codex/skills/goldband-investigate/SKILL.md"
grep -q '^name: goldband-review$' "$TMP_HOME/.codex/skills/goldband-review/SKILL.md"
grep -q '^name: goldband-qa$' "$TMP_HOME/.codex/skills/goldband-qa/SKILL.md"
grep -q '^name: goldband-ship$' "$TMP_HOME/.codex/skills/goldband-ship/SKILL.md"
grep -q '^name: goldband-claude$' "$TMP_HOME/.codex/skills/goldband-claude/SKILL.md"
test "$(sed -n '1p' "$TMP_HOME/.claude/commands/goldband-language.md")" = "---"
grep -q '提問、建議、選項、摘要與指令說明語言' "$TMP_HOME/.claude/commands/goldband-language.md"
grep -q '^  系統化除錯與根因調查。$' "$TMP_HOME/.codex/skills/goldband-investigate/SKILL.md"
grep -q '\$HOME/.claude/skills/goldband-review/review/checklist.md' "$TMP_HOME/.claude/skills/goldband-review/SKILL.md"
grep -q '\$HOME/.codex/skills/goldband-review/review/checklist.md' "$TMP_HOME/.codex/skills/goldband-review/SKILL.md"
grep -Eq '(gstack-config|workflow-config) get goldband_language' "$TMP_HOME/.codex/skills/goldband-investigate/SKILL.md"
grep -q 'GOLDBAND_LANGUAGE:' "$TMP_HOME/.codex/skills/goldband-investigate/SKILL.md"
grep -q '支援 `zh-TW` 與 `en`' "$TMP_HOME/.codex/skills/goldband-investigate/SKILL.md"
grep -q '\$HOME/.codex/skills/workflow' "$TMP_HOME/.codex/skills/goldband-investigate/SKILL.md"
grep -q '\.agents/skills/workflow' "$TMP_HOME/.codex/skills/goldband-investigate/SKILL.md"
grep -Eq '\.agents/skills/workflow/bin/(gstack-config|workflow-config)' "$TMP_HOME/.codex/skills/goldband-investigate/SKILL.md"
if grep -q '\[ -d "\$_ROOT/.agents/skills/workflow" \]' "$TMP_HOME/.codex/skills/goldband-investigate/SKILL.md"; then
  exit 1
fi
if grep -q "~/.claude/skills/$LEGACY_RUNTIME_NAME" "$TMP_HOME/.claude/skills/goldband-investigate/SKILL.md"; then
  exit 1
fi
if grep -q "\$HOME/.codex/skills/$LEGACY_RUNTIME_NAME" "$TMP_HOME/.codex/skills/goldband-investigate/SKILL.md"; then
  exit 1
fi
if grep -q ".agents/skills/$LEGACY_RUNTIME_NAME" "$TMP_HOME/.codex/skills/goldband-investigate/SKILL.md"; then
  exit 1
fi

HOME="$TMP_HOME" "$TMP_HOME/.claude/commands/scripts/set-goldband-language.sh" set en >/tmp/goldband-language-sync.log
grep -q '^  Systematic debugging and root-cause investigation.$' "$TMP_HOME/.codex/skills/goldband-investigate/SKILL.md"
test "$(HOME="$TMP_HOME" "$TMP_HOME/.claude/commands/scripts/set-goldband-language.sh" describe goldband-design-html en)" = "Turn design direction into reviewable HTML."
test "$(HOME="$TMP_HOME" "$TMP_HOME/.claude/commands/scripts/set-goldband-language.sh" describe goldband-workflow-upgrade zh-TW)" = "更新 bundled workflow runtime。"

FAKE_BIN="$TMP_HOME/fake-bin"
mkdir -p "$FAKE_BIN"
cat > "$FAKE_BIN/fake-update" <<'EOF'
#!/usr/bin/env bash
echo "update:$1" >> "$HOME/launcher.log"
EOF
cat > "$FAKE_BIN/claude" <<'EOF'
#!/usr/bin/env bash
echo "claude:$*" >> "$HOME/launcher.log"
EOF
cat > "$FAKE_BIN/codex" <<'EOF'
#!/usr/bin/env bash
echo "codex:$*" >> "$HOME/launcher.log"
EOF
chmod +x "$FAKE_BIN/fake-update" "$FAKE_BIN/claude" "$FAKE_BIN/codex"
HOME="$TMP_HOME" PATH="$FAKE_BIN:$PATH" GOLDBAND_SELF_UPDATE_BIN="$FAKE_BIN/fake-update" bash <<'EOF'
source "$HOME/.claude/shell/goldband-launchers.sh"
claude alpha
codex beta
EOF
grep -q '^update:claude$' "$TMP_HOME/launcher.log"
grep -q '^claude:alpha$' "$TMP_HOME/launcher.log"
grep -q '^update:codex$' "$TMP_HOME/launcher.log"
grep -q '^codex:beta$' "$TMP_HOME/launcher.log"

git init --bare --initial-branch=main "$TMP_UPDATE_ORIGIN/origin.git" >/dev/null
git clone "$TMP_UPDATE_ORIGIN/origin.git" "$TMP_UPDATE_SEED/repo" >/dev/null 2>&1
git -C "$TMP_UPDATE_SEED/repo" config user.name "goldband-test"
git -C "$TMP_UPDATE_SEED/repo" config user.email "goldband@example.com"
echo "v1" > "$TMP_UPDATE_SEED/repo/README.md"
git -C "$TMP_UPDATE_SEED/repo" add README.md
git -C "$TMP_UPDATE_SEED/repo" commit -m "init" >/dev/null
git -C "$TMP_UPDATE_SEED/repo" push -u origin main >/dev/null
git clone "$TMP_UPDATE_ORIGIN/origin.git" "$TMP_UPDATE_WORK/repo" >/dev/null 2>&1
OLD_HEAD="$(git -C "$TMP_UPDATE_WORK/repo" rev-parse HEAD)"
git clone "$TMP_UPDATE_ORIGIN/origin.git" "$TMP_UPDATE_SEED/repo-next" >/dev/null 2>&1
git -C "$TMP_UPDATE_SEED/repo-next" config user.name "goldband-test"
git -C "$TMP_UPDATE_SEED/repo-next" config user.email "goldband@example.com"
echo "v2" >> "$TMP_UPDATE_SEED/repo-next/README.md"
git -C "$TMP_UPDATE_SEED/repo-next" commit -am "update" >/dev/null
git -C "$TMP_UPDATE_SEED/repo-next" push origin main >/dev/null
HOME="$TMP_HOME" GOLDBAND_SELF_UPDATE_REPO_DIR="$TMP_UPDATE_WORK/repo" "$TMP_HOME/.claude/bin/goldband-self-update" >/tmp/goldband-self-update.log 2>&1
NEW_HEAD="$(git -C "$TMP_UPDATE_WORK/repo" rev-parse HEAD)"
test "$OLD_HEAD" != "$NEW_HEAD"
grep -q '\[goldband\] updated' /tmp/goldband-self-update.log

echo "[5/8] managed skill sync"
mkdir -p "$TMP_ROOT/skills/global/dummy-ui-skill"
cat > "$TMP_ROOT/skills/global/dummy-ui-skill/SKILL.md" <<'EOF'
---
name: dummy-ui-skill
description: test fixture
---
EOF
printf '%s\n' 'dummy-ui-skill|full|full' >> "$TMP_ROOT/shell/install/skill-catalog.txt"
test ! -e "$TMP_HOME/.claude/skills/dummy-ui-skill"
test ! -e "$TMP_HOME/.agents/skills/dummy-ui-skill"
HOME="$TMP_HOME" GOLDBAND_SELF_UPDATE_REPO_DIR="$TMP_ROOT" "$TMP_HOME/.claude/bin/goldband-self-update" >/tmp/goldband-skill-sync.log 2>&1
test -L "$TMP_HOME/.claude/skills/dummy-ui-skill"
test -L "$TMP_HOME/.agents/skills/dummy-ui-skill"
test "$(readlink "$TMP_HOME/.claude/skills/dummy-ui-skill")" = "$TMP_ROOT/skills/global/dummy-ui-skill"
test "$(readlink "$TMP_HOME/.agents/skills/dummy-ui-skill")" = "$TMP_ROOT/skills/global/dummy-ui-skill"
grep -q 'dummy-ui-skill' "$TMP_HOME/.claude/skills/.goldband-profile"
grep -q 'dummy-ui-skill' "$TMP_HOME/.agents/skills/.goldband-profile"
grep -q '\[goldband\] synced Claude skills profile from repo catalog\.' /tmp/goldband-skill-sync.log
grep -q '\[goldband\] synced Codex skills profile from repo catalog\.' /tmp/goldband-skill-sync.log
HOME="$TMP_HOME" GOLDBAND_SELF_UPDATE_REPO_DIR="$TMP_ROOT" "$TMP_HOME/.claude/bin/goldband-self-update" >/tmp/goldband-skill-sync-idempotent.log 2>&1
if [ -s /tmp/goldband-skill-sync-idempotent.log ]; then
  cat /tmp/goldband-skill-sync-idempotent.log >&2
  exit 1
fi
cp -R "$TMP_ROOT/." "$TMP_EMPTY_ROOT"
: > "$TMP_EMPTY_ROOT/shell/install/skill-catalog.txt"
HOME="$TMP_EMPTY_HOME" "$TMP_EMPTY_ROOT/install.sh" skills-full >/tmp/goldband-empty-skills.log
HOME="$TMP_EMPTY_HOME" "$TMP_EMPTY_ROOT/install.sh" codex-skills >/tmp/goldband-empty-codex-skills.log
grep -q '^skills=$' "$TMP_EMPTY_HOME/.claude/skills/.goldband-profile"
grep -q '^skills=$' "$TMP_EMPTY_HOME/.agents/skills/.goldband-profile"

echo "[6/8] status output"
STATUS_OUTPUT="$(CODEX_REQUIREMENTS_FILE="$TMP_HOME/.codex/requirements.toml" HOME="$TMP_HOME" "$TMP_ROOT/install.sh" status)"
assert_contains "$STATUS_OUTPUT" "workflow Claude install"
assert_contains "$STATUS_OUTPUT" "workflow Codex runtime (0.0.0-test)"
assert_contains "$STATUS_OUTPUT" "goldband wrapper language (en)"
assert_contains "$STATUS_OUTPUT" "shell launchers (zsh)"
assert_contains "$STATUS_OUTPUT" "claude CLAUDE.md"
assert_contains "$STATUS_OUTPUT" "codex custom agents"
assert_contains "$STATUS_OUTPUT" "codex hooks.json"
assert_contains "$STATUS_OUTPUT" "codex hook scripts"
assert_contains "$STATUS_OUTPUT" "codex-rules"
assert_contains "$STATUS_OUTPUT" "codex profiles"
assert_contains "$STATUS_OUTPUT" "codex requirements"
assert_contains "$STATUS_OUTPUT" "token-backed MCP env"
assert_contains "$STATUS_OUTPUT" "Git style gate 狀態"
assert_contains "$STATUS_OUTPUT" "global core.hooksPath -> $TMP_ROOT/git-hooks"

USER_CLAUDE_HOME="$TMP_HOME/user-owned-claude"
mkdir -p "$USER_CLAUDE_HOME/.claude"
printf '%s\n' 'user-owned claude guidance' > "$USER_CLAUDE_HOME/.claude/CLAUDE.md"
CODEX_REQUIREMENTS_FILE="$USER_CLAUDE_HOME/.codex/requirements.toml" HOME="$USER_CLAUDE_HOME" "$TMP_ROOT/install.sh" uninstall >/tmp/goldband-user-claude-uninstall.log
grep -q 'user-owned claude guidance' "$USER_CLAUDE_HOME/.claude/CLAUDE.md"

echo "[7/8] verifier output"
VERIFIER_OUTPUT="$(cd "$TMP_ROOT" && HOME="$TMP_HOME" USERPROFILE="$TMP_HOME" node "skills/global/claude-config-verification/scripts/verify-claude-config.js" --json || true)"
assert_contains "$VERIFIER_OUTPUT" '"claudeInstalled": true'
assert_contains "$VERIFIER_OUTPUT" '"codexInstalled": true'
assert_contains "$VERIFIER_OUTPUT" '"stateInstalled": true'
assert_contains "$VERIFIER_OUTPUT" '"codexVersion": "0.0.0-test"'
assert_contains "$VERIFIER_OUTPUT" '~/.codex/skills/goldband-\*'

echo "[8/8] language command flow docs"
grep -q '不要先讀目前設定' "$TMP_ROOT/commands/goldband-language.md"
grep -q '第一個提問固定用中英雙語短句' "$TMP_ROOT/commands/goldband-language.md"

echo "[OK] workflow integration smoke test passed"
