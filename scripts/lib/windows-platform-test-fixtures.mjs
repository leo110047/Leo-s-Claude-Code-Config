import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio: options.capture === false ? 'inherit' : 'pipe',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${cmd} ${args.join(' ')}`,
        result.stdout?.trim() ?? '',
        result.stderr?.trim() ?? '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
  return result;
}

function mktemp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function copyRepoSubset(rootDir, targetDir) {
  for (const entry of repoSubsetEntries()) {
    const source = path.join(rootDir, entry);
    const dest = path.join(targetDir, entry);
    fs.cpSync(source, dest, { recursive: true });
  }
}

function repoSubsetEntries() {
  return [
    'AGENTS.md',
    'install.ps1',
    'scripts',
    'shell',
    'skills',
    'hooks',
    'claude',
    'commands',
    'contexts',
    'rules',
    'codex',
    '.claude-plugin',
  ];
}

function createFakeWorkflow(targetDir) {
  const workflowDir = path.join(targetDir, 'vendor', 'workflow');
  createWorkflowDirectories(workflowDir);
  writeWorkflowMetadata(workflowDir);
  writeWorkflowSkillFiles(workflowDir);
  writeWorkflowBinFiles(workflowDir);
  writeWorkflowSetup(workflowDir);
}

function createWorkflowDirectories(workflowDir) {
  for (const dir of [
    'bin',
    'careful',
    'freeze',
    'investigate',
    'review',
    'qa',
    'ship',
    'browse',
  ]) {
    fs.mkdirSync(path.join(workflowDir, dir), { recursive: true });
  }
}

function writeWorkflowMetadata(workflowDir) {
  fs.writeFileSync(path.join(workflowDir, 'VERSION'), '0.0.0-test\n', 'utf8');
  fs.writeFileSync(
    path.join(workflowDir, 'SKILL.md'),
    ['---', 'name: workflow', 'description: test fixture', '---', ''].join(
      '\n',
    ),
    'utf8',
  );
}

function writeWorkflowSkillFiles(workflowDir) {
  for (const skill of workflowSkills()) {
    fs.writeFileSync(
      path.join(workflowDir, skill, 'SKILL.md'),
      skillFileContents(skill),
      'utf8',
    );
  }
  fs.writeFileSync(
    path.join(workflowDir, 'review', 'checklist.md'),
    '# test checklist\n',
    'utf8',
  );
}

function workflowSkills() {
  return ['careful', 'freeze', 'investigate', 'review', 'qa', 'ship', 'browse'];
}

function skillFileContents(skill) {
  return [
    '---',
    `name: ${skill}`,
    'description: test fixture',
    '---',
    skill === 'investigate' ? investigateSkillBody() : '',
    skill === 'review' ? reviewSkillBody() : '',
    '',
  ].join('\n');
}

function investigateSkillBody() {
  return [
    '```bash',
    'WORKFLOW_BIN="$HOME/.codex/skills/workflow/bin"',
    '_PROACTIVE=$($WORKFLOW_BIN/workflow-config get proactive 2>/dev/null || echo "true")',
    'source <(~/.claude/skills/workflow/bin/workflow-repo-mode 2>/dev/null) || true',
    '```',
  ].join('\n');
}

function reviewSkillBody() {
  return [
    'Read `.claude/skills/review/checklist.md`.',
    'Read `.agents/skills/workflow/review/checklist.md`.',
  ].join('\n');
}

function writeWorkflowBinFiles(workflowDir) {
  fs.writeFileSync(
    path.join(workflowDir, 'bin', 'workflow-repo-mode'),
    '#!/usr/bin/env bash\nexit 0\n',
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(workflowDir, 'bin', 'workflow-config'),
    workflowConfigScript(),
    { mode: 0o755 },
  );
}

function workflowConfigScript() {
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'STATE_DIR="${WORKFLOW_STATE_DIR:-$HOME/.workflow}"',
    'CONFIG_FILE="$STATE_DIR/config.yaml"',
    'case "${1:-}" in',
    '  get)',
    '    KEY="${2:?missing key}"',
    '    grep -E "^${KEY}:" "$CONFIG_FILE" 2>/dev/null | tail -1 | awk \'{print $2}\' | tr -d \'[:space:]\' || true',
    '    ;;',
    '  set)',
    '    KEY="${2:?missing key}"',
    '    VALUE="${3:?missing value}"',
    '    mkdir -p "$STATE_DIR"',
    '    if grep -qE "^${KEY}:" "$CONFIG_FILE" 2>/dev/null; then',
    '      python3 - "$CONFIG_FILE" "$KEY" "$VALUE" <<\'PY\'',
    ...pythonConfigUpdaterLines(),
    'PY',
    '    else',
    '      echo "${KEY}: ${VALUE}" >> "$CONFIG_FILE"',
    '    fi',
    '    ;;',
    '  list)',
    '    cat "$CONFIG_FILE" 2>/dev/null || true',
    '    ;;',
    '  *)',
    '    echo "Usage: workflow-config {get|set|list} [key] [value]" >&2',
    '    exit 1',
    '    ;;',
    'esac',
    '',
  ].join('\n');
}

function pythonConfigUpdaterLines() {
  return [
    'from pathlib import Path',
    'import sys',
    'config_file = Path(sys.argv[1])',
    'key = sys.argv[2]',
    'value = sys.argv[3]',
    'lines = config_file.read_text().splitlines() if config_file.exists() else []',
    'updated = []',
    'replaced = False',
    'for line in lines:',
    '    if line.startswith(f"{key}:"):',
    '        updated.append(f"{key}: {value}")',
    '        replaced = True',
    '    else:',
    '        updated.append(line)',
    'if not replaced:',
    '    updated.append(f"{key}: {value}")',
    'config_file.write_text("\\n".join(updated) + "\\n")',
  ];
}

function writeWorkflowSetup(workflowDir) {
  fs.writeFileSync(path.join(workflowDir, 'setup'), workflowSetupScript(), {
    mode: 0o755,
  });
}

function workflowSetupScript() {
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'HOST="claude"',
    ...setupArgParserLines(),
    'ROOT="$(cd "$(dirname "$0")" && pwd)"',
    'VERSION="$(cat "$ROOT/VERSION")"',
    'mkdir -p "$HOME/.workflow/projects"',
    '',
    ...installClaudeLines(),
    '',
    ...installCodexLines(),
    '',
    ...setupHostSwitchLines(),
    '',
  ].join('\n');
}

function setupArgParserLines() {
  return [
    'while [ $# -gt 0 ]; do',
    '  case "$1" in',
    '    --host) HOST="$2"; shift 2 ;;',
    '    --host=*) HOST="${1#--host=}"; shift ;;',
    '    *) shift ;;',
    '  esac',
    'done',
    '',
  ];
}

function installClaudeLines() {
  return [
    'install_claude() {',
    '  mkdir -p "$HOME/.claude/skills"',
    '  rm -rf "$HOME/.claude/skills/workflow"',
    '  ln -s "$ROOT" "$HOME/.claude/skills/workflow"',
    '}',
  ];
}

function installCodexLines() {
  return [
    'install_codex() {',
    '  mkdir -p "$HOME/.codex/skills"',
    '  rm -rf "$HOME/.codex/skills/workflow"',
    '  ln -s "$ROOT" "$HOME/.codex/skills/workflow"',
    '  for skill in investigate review qa ship careful freeze; do',
    ...generatedCodexSkillLines(),
    '  done',
    '  printf \'%s\\n\' "$VERSION" > "$HOME/.codex/skills/workflow/.installed-version"',
    '}',
  ];
}

function generatedCodexSkillLines() {
  return [
    '    target="$HOME/.codex/skills/workflow-$skill"',
    '    rm -rf "$target"',
    '    mkdir -p "$target"',
    '    cat > "$target/SKILL.md" <<SKILL',
    '---',
    'name: workflow-$skill',
    'description: generated test fixture',
    '---',
    '$(if [ "$skill" = "investigate" ]; then cat <<\'SKILL_BODY\'',
    '```bash',
    'WORKFLOW_ROOT="$HOME/.codex/skills/workflow"',
    '[ -n "$_ROOT" ] && [ -d "$_ROOT/.agents/skills/workflow" ] && WORKFLOW_ROOT="$_ROOT/.agents/skills/workflow"',
    'WORKFLOW_BIN="$WORKFLOW_ROOT/bin"',
    '_PROACTIVE=$($WORKFLOW_BIN/workflow-config get proactive 2>/dev/null || echo "true")',
    '```',
    'SKILL_BODY',
    'fi)',
    '$(if [ "$skill" = "review" ]; then cat <<\'SKILL_BODY\'',
    'Read `.agents/skills/workflow/review/checklist.md`.',
    'SKILL_BODY',
    'fi)',
    'SKILL',
  ];
}

function setupHostSwitchLines() {
  return [
    'case "$HOST" in',
    '  claude)',
    '    install_claude',
    '    ;;',
    '  codex)',
    '    install_codex',
    '    ;;',
    '  auto)',
    '    install_claude',
    '    install_codex',
    '    ;;',
    '  *)',
    '    echo "unsupported host: $HOST" >&2',
    '    exit 1',
    '    ;;',
    'esac',
  ];
}

function writeFakeGitScript(targetDir) {
  const scriptPath = path.join(targetDir, 'fake-git.sh');
  fs.writeFileSync(scriptPath, fakeGitScript(), { mode: 0o755 });
  return scriptPath;
}

function fakeGitScript() {
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'args=()',
    'while [ "$#" -gt 0 ]; do',
    '  if [ "$1" = "-C" ]; then',
    '    shift 2',
    '    continue',
    '  fi',
    '  args+=("$1")',
    '  shift',
    'done',
    ...fakeGitLogLines(),
    'sleep_ms="${GOLDBAND_FAKE_GIT_SLEEP_MS:-0}"',
    'if [ "$sleep_ms" -gt 0 ] 2>/dev/null; then',
    '  python3 -c "import time; time.sleep(int(${sleep_ms}) / 1000)"',
    'fi',
    'joined=""',
    'for arg in "${args[@]}"; do',
    '  if [ -n "$joined" ]; then joined="$joined "; fi',
    '  joined="${joined}${arg}"',
    'done',
    ...fakeGitCaseLines(),
    '',
  ].join('\n');
}

function fakeGitLogLines() {
  return [
    'if [ -n "${GOLDBAND_FAKE_GIT_LOG:-}" ]; then',
    '  joined=""',
    '  for arg in "${args[@]}"; do',
    '    if [ -n "$joined" ]; then joined="$joined "; fi',
    '    joined="${joined}${arg}"',
    '  done',
    '  printf \'{"args":"%s","gitTerminalPrompt":"%s"}\\n\' "$joined" "${GIT_TERMINAL_PROMPT:-}" >> "$GOLDBAND_FAKE_GIT_LOG"',
    'fi',
  ];
}

function fakeGitCaseLines() {
  return [
    'case "$joined" in',
    '  "rev-parse --abbrev-ref HEAD") printf "main\\n" ;;',
    '  "rev-parse --abbrev-ref --symbolic-full-name @{upstream}") printf "origin/main\\n" ;;',
    '  "status --porcelain") ;;',
    '  "rev-list --left-right --count HEAD...origin/main") printf "0 1\\n" ;;',
    '  "rev-parse --short HEAD") printf "abc123\\n" ;;',
    '  "fetch --quiet origin main") ;;',
    '  "pull --ff-only --quiet origin main") ;;',
    '  *) exit 1 ;;',
    'esac',
  ];
}

export { copyRepoSubset, createFakeWorkflow, mktemp, run, writeFakeGitScript };
