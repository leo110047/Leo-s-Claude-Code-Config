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

const unsupportedProjectionSource = path.join(
  home,
  'unsupported-multiline.config.toml',
);
fs.writeFileSync(
  unsupportedProjectionSource,
  ['values = [', '  "one",', ']'].join('\n'),
);
const unsupportedProjectionCheck = spawnSync(
  'bash',
  [
    '-c',
    'source shell/install/codex.sh; codex_config_projection_source_supported "$1"',
    'goldband-config-projection-check',
    unsupportedProjectionSource,
  ],
  {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
  },
);
assert.equal(
  unsupportedProjectionCheck.status,
  1,
  'unsupported multiline source values must fail the ownership projection closed',
);
const unavailableSyntaxCheck = spawnSync(
  'bash',
  [
    '-c',
    [
      'source shell/install/codex.sh',
      'PATH=/goldband-no-toml-parser',
      'codex_toml_syntax_valid "$1"',
      'result=$?',
      'printf "%s\\n" "$CODEX_CONFIG_FRESHNESS_REASON"',
      'exit "$result"',
    ].join('\n'),
    'goldband-config-syntax-check',
    installedConfigPath,
  ],
  {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
  },
);
assert.equal(
  unavailableSyntaxCheck.status,
  1,
  'missing TOML parser must fail config validation closed',
);
assert.equal(unavailableSyntaxCheck.stdout.trim(), 'syntax-unverifiable');

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

const sourcePluginOrder = [
  '[plugins."browser@openai-bundled"]',
  'enabled = true',
  '',
  '[plugins."chrome@openai-bundled"]',
  'enabled = true',
].join('\n');
const appPluginOrder = [
  '[plugins."chrome@openai-bundled"]',
  'enabled = true',
  '',
  '[plugins."browser@openai-bundled"]',
  'enabled = true',
].join('\n');
const installedConfigWithRuntimeState = fs.readFileSync(
  installedConfigPath,
  'utf8',
);
const configWithRuntimeState = installedConfigWithRuntimeState.includes(
  sourcePluginOrder,
)
  ? installedConfigWithRuntimeState
  : `${installedConfigWithRuntimeState.trimEnd()}\n\n${sourcePluginOrder}\n`;
const configWithAppManagedAdditions = configWithRuntimeState
  .replace(
    'shell_tool = true',
    ['shell_tool = true', 'js_repl = false'].join('\n'),
  )
  .replace(/last_updated = "[^"]+"/, 'last_updated = "2099-01-01T00:00:00Z"')
  .replace(sourcePluginOrder, appPluginOrder)
  .concat(
    [
      '',
      '[mcp_servers.node_repl]',
      'command = "/Applications/Codex.app/node_repl"',
      '',
      '[plugins."sites@openai-bundled"]',
      'enabled = true',
      '',
      '[desktop]',
      'followUpQueueMode = "queue"',
      '',
    ].join('\n'),
  );
fs.writeFileSync(installedConfigPath, configWithAppManagedAdditions);
statusResult = runStatus();
assert.equal(
  statusResult.status,
  0,
  'Codex App additions, reordering, and volatile marketplace timestamps must not make Goldband-managed config stale',
);
assert.match(stripAnsi(statusResult.stdout), /\[OK\] codex-config/);
assert.doesNotMatch(
  stripAnsi(statusResult.stdout),
  /stale: .*~\/\.codex\/config\.toml/,
  'Codex app status must reuse the ownership-aware freshness result',
);

fs.writeFileSync(
  installedConfigPath,
  configWithAppManagedAdditions.replace(
    '# Generated by goldband Codex config installer',
    [
      '# Generated by goldband Codex config installer',
      'this is invalid TOML',
    ].join('\n'),
  ),
);
statusResult = runStatus();
assert.equal(
  statusResult.status,
  2,
  'invalid installed TOML must fail before ownership comparison',
);
assert.match(
  stripAnsi(statusResult.stdout),
  /\[invalid\] codex-config — installed config\.toml is not valid TOML/,
);
assert.match(
  stripAnsi(statusResult.stdout),
  /invalid: ~\/\.codex\/config\.toml/,
  'Codex app status must report invalid config separately from stale config',
);
assert.doesNotMatch(stripAnsi(statusResult.stdout), /\[OK\] codex-config/);

fs.writeFileSync(
  installedConfigPath,
  configWithAppManagedAdditions.replace(
    '# Generated by goldband Codex config installer',
    [
      '# Generated by goldband Codex config installer',
      'model = "gpt-5.6-sol"',
    ].join('\n'),
  ),
);
statusResult = runStatus();
assert.equal(
  statusResult.status,
  2,
  'duplicate Goldband-owned keys must fail closed even when one value matches',
);
assert.match(
  stripAnsi(statusResult.stdout),
  /\[invalid\] codex-config — installed config\.toml is not valid TOML/,
);

fs.writeFileSync(
  installedConfigPath,
  `unexpected_root_key = true\n${configWithAppManagedAdditions}`,
);
statusResult = runStatus();
assert.equal(statusResult.status, 0);
assert.doesNotMatch(stripAnsi(statusResult.stdout), /\[OK\] codex-config/);
assert.match(stripAnsi(statusResult.stdout), /\[legacy copy\] codex-config/);

fs.writeFileSync(
  installedConfigPath,
  configWithAppManagedAdditions.replace(
    'model = "gpt-5.6-sol"',
    'model = "gpt-5.5"',
  ),
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
assert.match(
  stripAnsi(statusResult.stdout),
  /stale: ~\/\.codex\/config\.toml/,
  'Codex app status must distinguish a stale config from a missing config',
);
assert.doesNotMatch(
  stripAnsi(statusResult.stdout),
  /missing: .*~\/\.codex\/config\.toml/,
  'Codex app status must not call an existing stale config missing',
);

fs.writeFileSync(installedConfigPath, configWithAppManagedAdditions);

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
  [
    '',
    '[hooks.state]',
    '',
    '[hooks.state."/fixture/hooks.json:pre_tool_use:0:0"]',
    'trusted_hash = "sha256:fixture"',
    '',
    '[tui.model_availability_nux]',
    '"runtime-state-test" = 1',
    '',
  ].join('\n'),
);
assert.equal(
  fs.readFileSync(autoReviewSource, 'utf8'),
  originalSource,
  'runtime writes to installed Codex profile must not modify the repo source profile',
);

statusResult = runStatus();
assert.equal(
  statusResult.status,
  0,
  'Codex-owned runtime state must not make an installed profile stale',
);
assert.match(
  stripAnsi(statusResult.stdout),
  /\[OK\] codex profiles \(8\/8, materialized copies\)/,
);

for (const hostDir of ['.claude', '.codex']) {
  const runtimeRoot = path.join(home, hostDir, 'skills', 'goldband');
  const binRoot = path.join(runtimeRoot, 'bin');
  const contractRoot = path.join(runtimeRoot, 'workflows', 'knowledge');
  fs.mkdirSync(binRoot, { recursive: true });
  fs.mkdirSync(contractRoot, { recursive: true });
  for (const binary of ['goldband-knowledge', 'goldband-knowledge-review']) {
    const binaryPath = path.join(binRoot, binary);
    fs.writeFileSync(binaryPath, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(binaryPath, 0o755);
  }
  fs.copyFileSync(
    path.join(
      process.cwd(),
      'goldband-loop',
      'generated',
      'workflow-contracts',
      'knowledge',
      'recall.workflow.md',
    ),
    path.join(contractRoot, 'recall.workflow.md'),
  );
}

statusResult = runStatus();
assert.equal(
  statusResult.status,
  0,
  statusResult.stderr || statusResult.stdout,
);
assert.match(
  stripAnsi(statusResult.stdout),
  /\[OK\] Knowledge Claude workflow recall \(knowledge\/recall\)/,
);
assert.match(
  stripAnsi(statusResult.stdout),
  /\[OK\] Knowledge Codex workflow recall \(knowledge\/recall\)/,
);

fs.writeFileSync(
  autoReviewInstalled,
  fs
    .readFileSync(autoReviewInstalled, 'utf8')
    .replace(
      'model_reasoning_effort = "high"',
      'model_reasoning_effort = "low"',
    ),
);
statusResult = runStatus();
assert.match(
  stripAnsi(statusResult.stdout),
  /\[部分安裝\] codex profiles \(7\/8\)/,
  'managed profile drift must still be reported',
);

fs.rmSync(
  path.join(
    home,
    '.codex',
    'skills',
    'goldband',
    'workflows',
    'knowledge',
    'recall.workflow.md',
  ),
);
statusResult = runStatus();
assert.match(
  stripAnsi(statusResult.stdout),
  /\[未完整\] Knowledge Codex workflow recall not detected/,
  'missing knowledge recall contract must still be reported',
);

console.log('[OK] Codex runtime install tests passed');
