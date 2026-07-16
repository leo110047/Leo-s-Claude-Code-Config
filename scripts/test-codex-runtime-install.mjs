#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-codex-install-'));
const env = {
  ...process.env,
  HOME: home,
  CODEX_REQUIREMENTS_FILE: path.join(home, 'etc', 'codex', 'requirements.toml'),
};

function stripAnsi(value) {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function runStatus() {
  return spawnSync('./install.sh', ['status'], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
  });
}
const result = spawnSync('./install.sh', ['codex-hooks'], {
  cwd: process.cwd(),
  env,
  encoding: 'utf8',
});
assert.equal(result.status, 0, result.stderr || result.stdout);
assert.equal(
  fs.existsSync(
    path.join(home, '.codex', 'review-runtime', 'rules-resolver.js'),
  ),
  true,
  'codex-hooks install must materialize the review Rules resolver outside the hook directory symlink',
);

const profileSourceRoot = path.join(process.cwd(), 'codex', 'profiles');
const legacyAutoReviewSource = path.join(
  profileSourceRoot,
  'auto_review_experiment.config.toml',
);
const legacyAutoReviewDest = path.join(
  home,
  '.codex',
  'auto_review_experiment.config.toml',
);
fs.mkdirSync(path.dirname(legacyAutoReviewDest), { recursive: true });
fs.symlinkSync(legacyAutoReviewSource, legacyAutoReviewDest);

const configResult = spawnSync(
  './install.sh',
  ['codex-config', 'codex-requirements'],
  {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
  },
);
assert.equal(
  configResult.status,
  0,
  configResult.stderr || configResult.stdout,
);

const profileFiles = fs
  .readdirSync(profileSourceRoot)
  .filter((entry) => entry.endsWith('.config.toml'));
assert.ok(profileFiles.length > 0, 'codex profile fixture inventory is empty');

const installedConfigPath = path.join(home, '.codex', 'config.toml');
const installedConfig = fs.readFileSync(installedConfigPath, 'utf8');
const localConfigPath = path.join(
  process.cwd(),
  'codex',
  'local',
  'config.toml',
);
const expectedConfigStatus = fs.existsSync(localConfigPath)
  ? '[OK] codex-config (generated base + local overlay)'
  : '[OK] codex-config (generated base only)';
assert.match(
  installedConfig,
  /model = "gpt-5\.6-sol"/,
  'codex-config install must use the shared GPT-5.6 Sol default',
);
assert.doesNotMatch(
  installedConfig,
  /model = "gpt-5\.5"/,
  'codex-config install must not retain the previous GPT-5.5 default',
);
assert.match(
  installedConfig,
  /status_line = \["model-with-reasoning", "current-dir", "project-root", "git-branch"\]/,
  'codex-config install must use the context-neutral TUI status line',
);
assert.doesNotMatch(
  installedConfig,
  /context-remaining|context-used|five-hour-limit/,
  'codex-config install must not expose context or rate-limit countdowns in the TUI status line',
);

let statusResult = runStatus();
assert.equal(
  statusResult.status,
  0,
  statusResult.stderr || statusResult.stdout,
);
assert.ok(
  stripAnsi(statusResult.stdout).includes(expectedConfigStatus),
  `status must match the installed config source: ${expectedConfigStatus}`,
);

fs.appendFileSync(
  installedConfigPath,
  [
    '',
    '[hooks.state]',
    '',
    '[hooks.state."/fixture/hooks.json:pre_tool_use:0:0"]',
    'trusted_hash = "sha256:fixture"',
    '',
  ].join('\n'),
);
statusResult = runStatus();
assert.equal(
  statusResult.status,
  0,
  'Codex-owned hook trust state must not make the managed config stale',
);
assert.match(stripAnsi(statusResult.stdout), /\[OK\] codex-config/);

const configWithRuntimeState = fs.readFileSync(installedConfigPath, 'utf8');
fs.writeFileSync(
  installedConfigPath,
  `unexpected_root_key = true\n${configWithRuntimeState}`,
);
statusResult = runStatus();
assert.equal(statusResult.status, 0);
assert.doesNotMatch(stripAnsi(statusResult.stdout), /\[OK\] codex-config/);
assert.match(stripAnsi(statusResult.stdout), /\[legacy copy\] codex-config/);

fs.writeFileSync(
  installedConfigPath,
  configWithRuntimeState.replace('model = "gpt-5.6-sol"', 'model = "gpt-5.5"'),
);
statusResult = runStatus();
assert.equal(statusResult.status, 2);
assert.match(
  stripAnsi(statusResult.stdout),
  /\[stale\] codex-config — managed content differs from current sources/,
);
assert.match(
  stripAnsi(statusResult.stdout),
  /Codex app compatible shared config.*重跑 \.\/install\.sh codex-full/,
);

for (const profile of profileFiles) {
  const sourcePath = path.join(profileSourceRoot, profile);
  const installedPath = path.join(home, '.codex', profile);
  assert.equal(
    fs.existsSync(installedPath),
    true,
    `codex profile was not installed: ${profile}`,
  );
  assert.equal(
    fs.lstatSync(installedPath).isSymbolicLink(),
    false,
    `codex profile must be a materialized copy, not a symlink: ${profile}`,
  );
  assert.equal(
    fs.readFileSync(installedPath, 'utf8'),
    fs.readFileSync(sourcePath, 'utf8'),
    `codex profile copy differs from source: ${profile}`,
  );
}

const autoReviewSource = path.join(
  profileSourceRoot,
  'auto_review_experiment.config.toml',
);
const autoReviewInstalled = path.join(
  home,
  '.codex',
  'auto_review_experiment.config.toml',
);
const originalSource = fs.readFileSync(autoReviewSource, 'utf8');
fs.appendFileSync(
  autoReviewInstalled,
  '\n[tui.model_availability_nux]\n"runtime-state-test" = 1\n',
);
assert.equal(
  fs.readFileSync(autoReviewSource, 'utf8'),
  originalSource,
  'runtime writes to installed Codex profile must not modify the repo source profile',
);

console.log('[OK] Codex runtime install tests passed');
