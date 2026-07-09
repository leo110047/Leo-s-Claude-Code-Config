#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (options.allowFailure) return result;
  assert.equal(
    result.status,
    0,
    [command, ...args, result.stdout, result.stderr].join('\n'),
  );
  return result;
}

function makeTempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}.`));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function testInstallStateAndAutoRefresh() {
  const home = makeTempDir('goldband-auto-update-home');
  const env = {
    HOME: home,
    CODEX_REQUIREMENTS_FILE: path.join(
      home,
      'etc',
      'codex',
      'requirements.toml',
    ),
  };

  run('bash', ['./install.sh', 'codex-prompts'], { env });
  const stateFile = path.join(home, '.goldband', 'install-state.json');
  let state = readJson(stateFile);
  assert.deepEqual(state.targets, ['codex-prompts']);

  run('bash', ['./install.sh', 'pack-core'], { env });
  state = readJson(stateFile);
  for (const target of [
    'skills-core',
    'claude-guidance',
    'rules',
    'hooks',
    'launchers',
  ]) {
    assert.equal(state.targets.includes(target), true);
  }
  assert.equal(state.targets.includes('pack-core'), false);

  writeAutoRefreshTargets(stateFile, state);

  run('bash', ['./install.sh', 'auto-refresh'], {
    env: {
      ...env,
      GOLDBAND_AUTO_REFRESH_OLD_HEAD: 'old123',
      GOLDBAND_AUTO_REFRESH_NEW_HEAD: 'new456',
    },
  });

  state = readJson(stateFile);
  assert.equal(state.lastAutoRefresh.status, 'success');
  assert.match(state.lastAutoRefresh.message, /refreshed: codex-prompts/);
  assert.match(
    state.lastAutoRefresh.message,
    /skipped unsafe: hooks,rules,codex-hooks,codex-rules,codex-requirements/,
  );
  assert.equal(fs.existsSync(env.CODEX_REQUIREMENTS_FILE), false);

  const status = run('bash', ['./install.sh', 'status'], { env });
  assert.match(
    status.stdout,
    /auto-update tracked targets: codex-prompts, hooks, rules, codex-hooks, codex-rules, codex-requirements/,
  );
  assert.match(status.stdout, /last auto-refresh: success/);
}

function writeAutoRefreshTargets(stateFile, state) {
  state.targets = [
    'codex-prompts',
    'hooks',
    'rules',
    'codex-hooks',
    'codex-rules',
    'codex-requirements',
  ];
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
}

function git(repo, args) {
  return run('git', args, { cwd: repo });
}

function writeExecutable(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, { mode: 0o755 });
}

function commitAll(repo, message) {
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', message]);
}

function makeSelfUpdateRepo() {
  const work = makeTempDir('goldband-self-update-work');
  const remote = path.join(work, 'origin.git');
  const repo = path.join(work, 'repo');
  const updater = fs.readFileSync(
    path.join(root, 'shell', 'goldband-self-update.sh'),
    'utf8',
  );

  run('git', ['init', '--bare', remote]);
  run('git', ['init', '-b', 'main', repo]);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test User']);
  writeExecutable(path.join(repo, 'shell', 'goldband-self-update.sh'), updater);
  writeExecutable(
    path.join(repo, 'shell', 'goldband-sync-skills.sh'),
    '#!/usr/bin/env bash\nexit 0\n',
  );
  writeExecutable(
    path.join(repo, 'install.sh'),
    '#!/usr/bin/env bash\nset -euo pipefail\nif [ "${1:-}" = "auto-refresh" ]; then mkdir -p "$HOME/.goldband"; echo "${GOLDBAND_AUTO_REFRESH_OLD_HEAD:-}:${GOLDBAND_AUTO_REFRESH_NEW_HEAD:-}" > "$HOME/.goldband/refresh-ran"; exit 0; fi\n',
  );
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'one\n');
  commitAll(repo, 'initial');
  git(repo, ['remote', 'add', 'origin', remote]);
  git(repo, ['push', '-u', 'origin', 'main']);
  git(remote, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  return { work, remote, repo };
}

function addRemoteCommit(remote, work, options = {}) {
  const clone = path.join(work, options.cloneName || 'clone');
  run('git', ['clone', remote, clone]);
  git(clone, ['config', 'user.email', 'test@example.com']);
  git(clone, ['config', 'user.name', 'Test User']);
  fs.writeFileSync(
    path.join(clone, options.file || 'remote.txt'),
    options.content || 'remote\n',
  );
  commitAll(clone, options.message || 'remote update');
  git(clone, ['push', 'origin', 'main']);
}

function testSelfUpdateDirtyFastForward() {
  const home = makeTempDir('goldband-self-update-home');
  const { work, remote, repo } = makeSelfUpdateRepo();
  addRemoteCommit(remote, work);

  fs.writeFileSync(path.join(repo, 'dirty.txt'), 'local dirty file\n');
  const oldHead = git(repo, ['rev-parse', '--short', 'HEAD']).stdout.trim();
  run('bash', [path.join(repo, 'shell', 'goldband-self-update.sh')], {
    cwd: repo,
    env: {
      HOME: home,
      GOLDBAND_SELF_UPDATE_REPO_DIR: repo,
      GOLDBAND_SELF_UPDATE_TIMEOUT: '10',
    },
  });

  const newHead = git(repo, ['rev-parse', '--short', 'HEAD']).stdout.trim();
  assert.notEqual(newHead, oldHead);
  assert.equal(
    fs.readFileSync(path.join(repo, 'dirty.txt'), 'utf8'),
    'local dirty file\n',
  );
  assert.equal(fs.existsSync(path.join(repo, 'remote.txt')), true);
  assert.equal(
    fs.readFileSync(path.join(home, '.goldband', 'refresh-ran'), 'utf8').trim(),
    `${oldHead}:${newHead}`,
  );
}

function testSelfUpdateDirtyTrackedConflictSkipsRefresh() {
  const home = makeTempDir('goldband-self-update-conflict-home');
  const { work, remote, repo } = makeSelfUpdateRepo();
  addRemoteCommit(remote, work, {
    cloneName: 'clone-conflict',
    file: 'tracked.txt',
    content: 'remote update\n',
    message: 'remote tracked update',
  });

  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'local dirty update\n');
  const oldHead = git(repo, ['rev-parse', '--short', 'HEAD']).stdout.trim();
  run('bash', [path.join(repo, 'shell', 'goldband-self-update.sh')], {
    cwd: repo,
    env: {
      HOME: home,
      GOLDBAND_SELF_UPDATE_REPO_DIR: repo,
      GOLDBAND_SELF_UPDATE_TIMEOUT: '10',
    },
  });

  const newHead = git(repo, ['rev-parse', '--short', 'HEAD']).stdout.trim();
  assert.equal(newHead, oldHead);
  assert.equal(
    fs.readFileSync(path.join(repo, 'tracked.txt'), 'utf8'),
    'local dirty update\n',
  );
  assert.equal(
    fs.existsSync(path.join(home, '.goldband', 'refresh-ran')),
    false,
  );
}

testInstallStateAndAutoRefresh();
testSelfUpdateDirtyFastForward();
testSelfUpdateDirtyTrackedConflictSkipsRefresh();
console.log('[OK] auto-update installer refresh tests passed');
