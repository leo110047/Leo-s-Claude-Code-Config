#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio: options.capture === false ? 'inherit' : 'pipe',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error([
      `Command failed: ${cmd} ${args.join(' ')}`,
      result.stdout?.trim() ?? '',
      result.stderr?.trim() ?? '',
    ].filter(Boolean).join('\n'));
  }
  return result;
}

function mktemp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function copyRepoSubset(targetDir) {
  const entries = [
    'AGENTS.md',
    'install.ps1',
    'scripts',
    'shell',
    'skills',
    'hooks',
    'commands',
    'contexts',
    'rules',
    'codex',
    '.claude-plugin',
  ];

  for (const entry of entries) {
    const source = path.join(ROOT_DIR, entry);
    const dest = path.join(targetDir, entry);
    fs.cpSync(source, dest, { recursive: true });
  }
}

function createFakeWorkflow(targetDir) {
  const workflowDir = path.join(targetDir, 'vendor', 'workflow');
  fs.mkdirSync(path.join(workflowDir, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(workflowDir, 'careful'), { recursive: true });
  fs.mkdirSync(path.join(workflowDir, 'freeze'), { recursive: true });
  fs.mkdirSync(path.join(workflowDir, 'investigate'), { recursive: true });
  fs.mkdirSync(path.join(workflowDir, 'review'), { recursive: true });
  fs.mkdirSync(path.join(workflowDir, 'qa'), { recursive: true });
  fs.mkdirSync(path.join(workflowDir, 'ship'), { recursive: true });
  fs.mkdirSync(path.join(workflowDir, 'browse'), { recursive: true });

  fs.writeFileSync(path.join(workflowDir, 'VERSION'), '0.0.0-test\n', 'utf8');
  fs.writeFileSync(path.join(workflowDir, 'SKILL.md'), ['---', 'name: workflow', 'description: test fixture', '---', ''].join('\n'), 'utf8');

  for (const skill of ['careful', 'freeze', 'investigate', 'review', 'qa', 'ship', 'browse']) {
    const body = skill === 'investigate'
      ? [
        '```bash',
        'WORKFLOW_BIN="$HOME/.codex/skills/workflow/bin"',
        '_PROACTIVE=$($WORKFLOW_BIN/workflow-config get proactive 2>/dev/null || echo "true")',
        'source <(~/.claude/skills/workflow/bin/workflow-repo-mode 2>/dev/null) || true',
        '```',
      ].join('\n')
      : '';
    fs.writeFileSync(
      path.join(workflowDir, skill, 'SKILL.md'),
      ['---', `name: ${skill}`, 'description: test fixture', '---', body, ''].join('\n'),
      'utf8',
    );
  }

  fs.writeFileSync(path.join(workflowDir, 'review', 'checklist.md'), '# test checklist\n', 'utf8');
  fs.writeFileSync(path.join(workflowDir, 'bin', 'workflow-repo-mode'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(
    path.join(workflowDir, 'bin', 'workflow-config'),
    [
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
    ].join('\n'),
    { mode: 0o755 },
  );

  fs.writeFileSync(
    path.join(workflowDir, 'setup'),
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'HOST="claude"',
      'while [ $# -gt 0 ]; do',
      '  case "$1" in',
      '    --host) HOST="$2"; shift 2 ;;',
      '    --host=*) HOST="${1#--host=}"; shift ;;',
      '    *) shift ;;',
      '  esac',
      'done',
      '',
      'ROOT="$(cd "$(dirname "$0")" && pwd)"',
      'VERSION="$(cat "$ROOT/VERSION")"',
      'mkdir -p "$HOME/.workflow/projects"',
      '',
      'install_claude() {',
      '  mkdir -p "$HOME/.claude/skills"',
      '  rm -rf "$HOME/.claude/skills/workflow"',
      '  ln -s "$ROOT" "$HOME/.claude/skills/workflow"',
      '}',
      '',
      'install_codex() {',
      '  mkdir -p "$HOME/.codex/skills"',
      '  rm -rf "$HOME/.codex/skills/workflow"',
      '  ln -s "$ROOT" "$HOME/.codex/skills/workflow"',
      '  for skill in investigate review qa ship careful freeze; do',
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
      'SKILL',
      '  done',
      '  printf \'%s\\n\' "$VERSION" > "$HOME/.codex/skills/workflow/.installed-version"',
      '}',
      '',
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
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
}

function writeFakeGitScript(targetDir) {
  const scriptPath = path.join(targetDir, 'fake-git.sh');
  fs.writeFileSync(
    scriptPath,
    [
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
      'if [ -n "${GOLDBAND_FAKE_GIT_LOG:-}" ]; then',
      '  joined=""',
      '  for arg in "${args[@]}"; do',
      '    if [ -n "$joined" ]; then joined="$joined "; fi',
      '    joined="${joined}${arg}"',
      '  done',
      '  printf \'{"args":"%s","gitTerminalPrompt":"%s"}\\n\' "$joined" "${GIT_TERMINAL_PROMPT:-}" >> "$GOLDBAND_FAKE_GIT_LOG"',
      'fi',
      'sleep_ms="${GOLDBAND_FAKE_GIT_SLEEP_MS:-0}"',
      'if [ "$sleep_ms" -gt 0 ] 2>/dev/null; then',
      '  python3 -c "import time; time.sleep(int(${sleep_ms}) / 1000)"',
      'fi',
      'joined=""',
      'for arg in "${args[@]}"; do',
      '  if [ -n "$joined" ]; then joined="$joined "; fi',
      '  joined="${joined}${arg}"',
      'done',
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
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  return scriptPath;
}

function readProfile(profilePath) {
  const raw = fs.readFileSync(profilePath, 'utf8');
  return Object.fromEntries(
    raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

function installArgs(repoDir, homeDir, ...actions) {
  return [
    path.join(repoDir, 'scripts', 'goldband-windows.mjs'),
    'install',
    ...actions,
    '--platform', 'win32',
    '--home', homeDir,
    '--repo', repoDir,
  ];
}

function syncArgs(repoDir, homeDir, ...extraArgs) {
  return [
    path.join(repoDir, 'scripts', 'goldband-windows.mjs'),
    'sync-skills',
    '--platform', 'win32',
    '--home', homeDir,
    '--repo', repoDir,
    ...extraArgs,
  ];
}

function statusArgs(repoDir, homeDir, ...extraArgs) {
  return [
    path.join(repoDir, 'scripts', 'goldband-windows.mjs'),
    'status',
    '--platform', 'win32',
    '--home', homeDir,
    '--repo', repoDir,
    ...extraArgs,
  ];
}

function selfUpdateArgs(repoDir, homeDir, ...extraArgs) {
  return [
    path.join(repoDir, 'scripts', 'goldband-windows.mjs'),
    'self-update',
    '--platform', 'win32',
    '--home', homeDir,
    '--repo', repoDir,
    ...extraArgs,
  ];
}

function uninstallArgs(repoDir, homeDir, ...extraArgs) {
  return [
    path.join(repoDir, 'scripts', 'goldband-windows.mjs'),
    'uninstall',
    '--platform', 'win32',
    '--home', homeDir,
    '--repo', repoDir,
    ...extraArgs,
  ];
}

function main() {
  const tmpHome = mktemp('goldband-win-home.');
  const tmpRoot = mktemp('goldband-win-root.');
  const tmpOrigin = mktemp('goldband-win-origin.');
  const tmpSeed = mktemp('goldband-win-seed.');
  const tmpWork = mktemp('goldband-win-work.');

  try {
    copyRepoSubset(tmpRoot);
    createFakeWorkflow(tmpRoot);

    console.log('[1/7] windows-mode all-tools');
    run(process.execPath, installArgs(tmpRoot, tmpHome, 'all-tools'), {
      env: { ...process.env, GOLDBAND_TEST_FORCE_FILE_COPY: '1' },
    });

    const claudeProfile = readProfile(path.join(tmpHome, '.claude', 'skills', '.goldband-profile'));
    const codexProfile = readProfile(path.join(tmpHome, '.agents', 'skills', '.goldband-profile'));
    assert.match(claudeProfile.skills, /\bfrontend-design\b/);
    assert.match(codexProfile.skills, /\bfrontend-design\b/);
    assert.ok(fs.existsSync(path.join(tmpHome, '.claude', 'commands')));
    assert.ok(fs.existsSync(path.join(tmpHome, '.codex', 'AGENTS.md')));
    assert.ok(fs.existsSync(path.join(tmpHome, '.claude', 'bin', 'goldband-self-update.ps1')));
    assert.ok(fs.existsSync(path.join(tmpHome, '.claude', 'shell', 'goldband-launchers.ps1')));

    const pwsh7Profile = fs.readFileSync(
      path.join(tmpHome, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1'),
      'utf8',
    );
    assert.match(pwsh7Profile, /goldband-launchers\.ps1/);
    assert.ok(fs.existsSync(path.join(tmpHome, '.claude', '.goldband-windows-state.json')));

    fs.appendFileSync(path.join(tmpRoot, 'codex', 'AGENTS.md'), '\nwindows-copy-refresh\n', 'utf8');
    run(process.execPath, selfUpdateArgs(tmpRoot, tmpHome), {
      env: { ...process.env, GOLDBAND_TEST_FORCE_FILE_COPY: '1' },
    });
    const refreshedCodexAgents = fs.readFileSync(path.join(tmpHome, '.codex', 'AGENTS.md'), 'utf8');
    assert.match(refreshedCodexAgents, /windows-copy-refresh/);

    console.log('[2/7] windows-mode workflow');
    run(process.execPath, installArgs(tmpRoot, tmpHome, 'all-with-workflow'));
    assert.ok(fs.existsSync(path.join(tmpHome, '.claude', 'skills', 'workflow')));
    assert.ok(fs.existsSync(path.join(tmpHome, '.codex', 'skills', 'workflow')));
    assert.ok(fs.existsSync(path.join(tmpHome, '.codex', 'skills', 'goldband-investigate', 'SKILL.md')));

    console.log('[3/7] windows-mode sync-skills');
    fs.mkdirSync(path.join(tmpRoot, 'skills', 'global', 'dummy-win-skill'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpRoot, 'skills', 'global', 'dummy-win-skill', 'SKILL.md'),
      ['---', 'name: dummy-win-skill', 'description: test fixture', '---', ''].join('\n'),
      'utf8',
    );
    fs.appendFileSync(
      path.join(tmpRoot, 'shell', 'install', 'skill-catalog.txt'),
      '\ndummy-win-skill|full|full\n',
      'utf8',
    );
    run(process.execPath, syncArgs(tmpRoot, tmpHome));
    assert.ok(fs.existsSync(path.join(tmpHome, '.claude', 'skills', 'dummy-win-skill')));
    assert.ok(fs.existsSync(path.join(tmpHome, '.agents', 'skills', 'dummy-win-skill')));

    console.log('[4/7] windows-mode status');
    const status = run(process.execPath, statusArgs(tmpRoot, tmpHome));
    assert.match(status.stdout, /PowerShell launchers: installed/);
    assert.match(status.stdout, /Workflow Claude runtime: installed/);

    console.log('[5/7] windows-mode self-update guardrails');
    fs.mkdirSync(path.join(tmpRoot, '.git'), { recursive: true });
    const fakeGitLog = path.join(tmpRoot, 'fake-git.log');
    fs.writeFileSync(fakeGitLog, '', 'utf8');
    const fakeGit = writeFakeGitScript(tmpRoot);
    const guardrailStart = Date.now();
    run(
      process.execPath,
      selfUpdateArgs(tmpRoot, tmpHome, '--git', fakeGit, '--self-update-timeout', '0.2'),
      {
        env: {
          ...process.env,
          GOLDBAND_FAKE_GIT_LOG: fakeGitLog,
          GOLDBAND_FAKE_GIT_SLEEP_MS: '1500',
          GOLDBAND_TEST_FORCE_FILE_COPY: '1',
        },
      },
    );
    const guardrailElapsedMs = Date.now() - guardrailStart;
    assert.ok(guardrailElapsedMs < 1200, `self-update timeout should stop fetch quickly, got ${guardrailElapsedMs}ms`);
    fs.rmSync(path.join(tmpRoot, '.git'), { recursive: true, force: true });

    console.log('[6/7] windows-mode self-update');
    run('git', ['init', '--bare', '--initial-branch=main', path.join(tmpOrigin, 'origin.git')]);
    run('git', ['clone', path.join(tmpOrigin, 'origin.git'), path.join(tmpSeed, 'repo')]);
    run('git', ['-C', path.join(tmpSeed, 'repo'), 'config', 'user.name', 'goldband-test']);
    run('git', ['-C', path.join(tmpSeed, 'repo'), 'config', 'user.email', 'goldband@example.com']);
    copyRepoSubset(path.join(tmpSeed, 'repo'));
    run('git', ['-C', path.join(tmpSeed, 'repo'), 'add', '.']);
    run('git', ['-C', path.join(tmpSeed, 'repo'), 'commit', '-m', 'seed']);
    run('git', ['-C', path.join(tmpSeed, 'repo'), 'push', '-u', 'origin', 'main']);

    run('git', ['clone', path.join(tmpOrigin, 'origin.git'), path.join(tmpWork, 'repo')]);
    const oldHead = run('git', ['-C', path.join(tmpWork, 'repo'), 'rev-parse', 'HEAD']).stdout.trim();

    run('git', ['clone', path.join(tmpOrigin, 'origin.git'), path.join(tmpSeed, 'repo-next')]);
    run('git', ['-C', path.join(tmpSeed, 'repo-next'), 'config', 'user.name', 'goldband-test']);
    run('git', ['-C', path.join(tmpSeed, 'repo-next'), 'config', 'user.email', 'goldband@example.com']);
    fs.appendFileSync(path.join(tmpSeed, 'repo-next', 'AGENTS.md'), '\nwindows-update\n', 'utf8');
    run('git', ['-C', path.join(tmpSeed, 'repo-next'), 'commit', '-am', 'update']);
    run('git', ['-C', path.join(tmpSeed, 'repo-next'), 'push', 'origin', 'main']);

    run(process.execPath, selfUpdateArgs(path.join(tmpWork, 'repo'), tmpHome));
    const newHead = run('git', ['-C', path.join(tmpWork, 'repo'), 'rev-parse', 'HEAD']).stdout.trim();
    assert.notStrictEqual(oldHead, newHead);

    console.log('[7/7] windows-mode uninstall');
    run(process.execPath, uninstallArgs(tmpRoot, tmpHome));
    assert.ok(!fs.existsSync(path.join(tmpHome, '.claude', '.goldband-windows-state.json')));
    assert.ok(!fs.existsSync(path.join(tmpHome, '.claude', 'bin', 'goldband-self-update.ps1')));
    assert.ok(!fs.existsSync(path.join(tmpHome, '.claude', 'shell', 'goldband-launchers.ps1')));
    const settingsAfterUninstall = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude', 'settings.json'), 'utf8'));
    assert.equal(settingsAfterUninstall.hooks, undefined);
    assert.equal(settingsAfterUninstall.statusLine, undefined);
    assert.ok(!(settingsAfterUninstall.permissions?.allow ?? []).includes('Bash(node *)'));

    console.log('[OK] windows platform integration smoke test passed');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(tmpOrigin, { recursive: true, force: true });
    fs.rmSync(tmpSeed, { recursive: true, force: true });
    fs.rmSync(tmpWork, { recursive: true, force: true });
  }
}

main();
