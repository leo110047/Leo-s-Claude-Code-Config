import assert from 'node:assert/strict';
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
    '.gitignore',
    'AGENTS.md',
    'install.ps1',
    'scripts',
    'shell',
    'skills',
    'hooks',
    'claude',
    'commands',
    'rules',
    'codex',
    '.claude-plugin',
  ];
}

function createFakeWorkflow(targetDir) {
  const loopDir = path.join(targetDir, 'goldband-loop');
  createLoopDirectories(loopDir);
  writeLoopMetadata(loopDir);
  writeLoopSkillFiles(loopDir);
  writeLoopBinFiles(loopDir);
  writeLoopSetup(loopDir);
}

function createLoopDirectories(loopDir) {
  for (const dir of ['bin', 'review', '.agents/skills', ...loopSkills()]) {
    fs.mkdirSync(path.join(loopDir, dir), { recursive: true });
  }
}

function writeLoopMetadata(loopDir) {
  fs.writeFileSync(path.join(loopDir, 'VERSION'), '0.0.0-test\n', 'utf8');
  writeSkillFile(loopDir, 'goldband');
}

function writeLoopSkillFiles(loopDir) {
  for (const skill of loopSkills()) {
    writeSkillFile(path.join(loopDir, skill), `goldband-${skill}`);
    writeSkillFile(
      path.join(loopDir, '.agents', 'skills', `goldband-${skill}`),
      `goldband-${skill}`,
    );
  }
  fs.writeFileSync(
    path.join(loopDir, 'review', 'checklist.md'),
    '# test checklist\n',
    'utf8',
  );
}

function loopSkills() {
  return ['investigate', 'review', 'qa', 'ship', 'browse', 'goldband-upgrade'];
}

function writeSkillFile(skillDir, skillName) {
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    ['---', `name: ${skillName}`, 'description: test fixture', '---', ''].join(
      '\n',
    ),
    'utf8',
  );
}

function writeLoopBinFiles(loopDir) {
  fs.writeFileSync(
    path.join(loopDir, 'bin', 'goldband-repo-mode'),
    '#!/usr/bin/env bash\nprintf "REPO_MODE=solo\\n"\n',
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(loopDir, 'bin', 'goldband-config'),
    goldbandConfigScript(),
    { mode: 0o755 },
  );
}

function goldbandConfigScript() {
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'STATE_DIR="${GOLDBAND_HOME:-$HOME/.goldband}"',
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
    '    echo "${KEY}: ${VALUE}" >> "$CONFIG_FILE"',
    '    ;;',
    '  list)',
    '    cat "$CONFIG_FILE" 2>/dev/null || true',
    '    ;;',
    '  *)',
    '    echo "Usage: goldband-config {get|set|list} [key] [value]" >&2',
    '    exit 1',
    '    ;;',
    'esac',
    '',
  ].join('\n');
}

function writeLoopSetup(loopDir) {
  fs.writeFileSync(path.join(loopDir, 'setup'), loopSetupScript(), {
    mode: 0o755,
  });
}

function loopSetupScript() {
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'HOST="claude"',
    ...setupArgParserLines(),
    'ROOT="$(cd "$(dirname "$0")" && pwd)"',
    'VERSION="$(cat "$ROOT/VERSION")"',
    'mkdir -p "$HOME/.goldband/projects"',
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
    '  rm -rf "$HOME/.claude/skills/goldband"',
    '  cp -R "$ROOT" "$HOME/.claude/skills/goldband"',
    '  rm -rf "$HOME/.claude/skills/_goldband-command"',
    '  mkdir -p "$HOME/.claude/skills/_goldband-command"',
    '  cp "$ROOT/SKILL.md" "$HOME/.claude/skills/_goldband-command/SKILL.md"',
    '  for skill_dir in "$ROOT"/*; do',
    '    [ -f "$skill_dir/SKILL.md" ] || continue',
    '    skill_name="$(sed -n \'s/^name:[[:space:]]*//p\' "$skill_dir/SKILL.md" | head -1)"',
    '    [ "$skill_name" = "goldband" ] && continue',
    '    rm -rf "$HOME/.claude/skills/$skill_name"',
    '    cp -R "$skill_dir" "$HOME/.claude/skills/$skill_name"',
    '  done',
    '  printf \'%s\\n\' "$VERSION" > "$HOME/.claude/skills/goldband/.installed-version"',
    '}',
  ];
}

function installCodexLines() {
  return [
    'install_codex() {',
    '  mkdir -p "$HOME/.codex/skills"',
    '  rm -rf "$HOME/.codex/skills/goldband"',
    '  mkdir -p "$HOME/.codex/skills/goldband/bin" "$HOME/.codex/skills/goldband/review"',
    '  cp "$ROOT/SKILL.md" "$HOME/.codex/skills/goldband/SKILL.md"',
    '  cp "$ROOT/bin/goldband-config" "$HOME/.codex/skills/goldband/bin/goldband-config"',
    '  cp "$ROOT/bin/goldband-repo-mode" "$HOME/.codex/skills/goldband/bin/goldband-repo-mode"',
    '  cp "$ROOT/review/checklist.md" "$HOME/.codex/skills/goldband/review/checklist.md"',
    '  for skill_dir in "$ROOT/.agents/skills"/goldband-*; do',
    '    [ -f "$skill_dir/SKILL.md" ] || continue',
    '    skill_name="$(basename "$skill_dir")"',
    '    rm -rf "$HOME/.codex/skills/$skill_name"',
    '    cp -R "$skill_dir" "$HOME/.codex/skills/$skill_name"',
    '  done',
    '  printf \'%s\\n\' "$VERSION" > "$HOME/.codex/skills/goldband/.installed-version"',
    '}',
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

function runWindowsSelfUpdateScenario({
  context,
  rootDir,
  selfUpdateArgs,
  nodePath,
}) {
  console.log('[6/7] windows-mode self-update');
  seedOriginRepo(context, rootDir);
  const repoDir = path.join(context.tmpWork, 'repo');
  const oldHead = cloneWorkRepo(context);
  pushNextCommit(context);
  const beforeSelfUpdate = gitDiagnostics(repoDir);
  const selfUpdate = run(nodePath, selfUpdateArgs(repoDir, context.tmpHome));
  const afterSelfUpdate = gitDiagnostics(repoDir);
  const newHead = gitHead(repoDir);
  assert.notStrictEqual(
    oldHead,
    newHead,
    selfUpdateFailureMessage({
      oldHead,
      newHead,
      selfUpdate,
      beforeSelfUpdate,
      afterSelfUpdate,
    }),
  );
}

function seedOriginRepo({ tmpOrigin, tmpSeed }, rootDir) {
  run('git', [
    'init',
    '--bare',
    '--initial-branch=main',
    path.join(tmpOrigin, 'origin.git'),
  ]);
  run('git', [
    'clone',
    path.join(tmpOrigin, 'origin.git'),
    path.join(tmpSeed, 'repo'),
  ]);
  configureGitUser(path.join(tmpSeed, 'repo'));
  copyRepoSubset(rootDir, path.join(tmpSeed, 'repo'));
  run('git', ['-C', path.join(tmpSeed, 'repo'), 'add', '.']);
  gitCommitNoHooks(path.join(tmpSeed, 'repo'), ['-m', 'seed']);
  run('git', [
    '-C',
    path.join(tmpSeed, 'repo'),
    'push',
    '-u',
    'origin',
    'main',
  ]);
}

function configureGitUser(repoDir) {
  run('git', ['-C', repoDir, 'config', 'user.name', 'goldband-test']);
  run('git', ['-C', repoDir, 'config', 'user.email', 'goldband@example.com']);
}

function gitCommitNoHooks(repoDir, args) {
  run('git', ['-c', 'core.hooksPath=', '-C', repoDir, 'commit', ...args]);
}

function cloneWorkRepo({ tmpOrigin, tmpWork }) {
  run('git', [
    'clone',
    path.join(tmpOrigin, 'origin.git'),
    path.join(tmpWork, 'repo'),
  ]);
  return gitHead(path.join(tmpWork, 'repo'));
}

function gitHead(repoDir) {
  return run('git', ['-C', repoDir, 'rev-parse', 'HEAD']).stdout.trim();
}

function pushNextCommit({ tmpOrigin, tmpSeed }) {
  const repoNext = path.join(tmpSeed, 'repo-next');
  run('git', ['clone', path.join(tmpOrigin, 'origin.git'), repoNext]);
  configureGitUser(repoNext);
  fs.appendFileSync(
    path.join(repoNext, 'AGENTS.md'),
    '\nwindows-update\n',
    'utf8',
  );
  gitCommitNoHooks(repoNext, ['-am', 'update']);
  run('git', ['-C', repoNext, 'push', 'origin', 'main']);
}

function gitDiagnostics(repoDir) {
  return {
    head: gitProbe(repoDir, ['rev-parse', 'HEAD']),
    branch: gitProbe(repoDir, ['rev-parse', '--abbrev-ref', 'HEAD']),
    upstream: gitProbe(repoDir, [
      'rev-parse',
      '--abbrev-ref',
      '--symbolic-full-name',
      '@{upstream}',
    ]),
    status: gitProbe(repoDir, ['status', '--porcelain']),
    aheadBehind: gitProbe(repoDir, [
      'rev-list',
      '--left-right',
      '--count',
      'HEAD...origin/main',
    ]),
    originMain: gitProbe(repoDir, ['rev-parse', 'origin/main']),
    remoteMain: gitProbe(repoDir, ['ls-remote', 'origin', 'refs/heads/main']),
  };
}

function gitProbe(repoDir, args) {
  const result = spawnSync('git', ['-C', repoDir, ...args], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return {
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function selfUpdateFailureMessage({
  oldHead,
  newHead,
  selfUpdate,
  beforeSelfUpdate,
  afterSelfUpdate,
}) {
  return [
    'self-update did not fast-forward the test repo',
    `oldHead=${oldHead}`,
    `newHead=${newHead}`,
    `selfUpdate.stdout=${JSON.stringify(selfUpdate.stdout.trim())}`,
    `selfUpdate.stderr=${JSON.stringify(selfUpdate.stderr.trim())}`,
    `before=${JSON.stringify(beforeSelfUpdate, null, 2)}`,
    `after=${JSON.stringify(afterSelfUpdate, null, 2)}`,
  ].join('\n');
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

export {
  copyRepoSubset,
  createFakeWorkflow,
  mktemp,
  run,
  runWindowsSelfUpdateScenario,
  writeFakeGitScript,
};
