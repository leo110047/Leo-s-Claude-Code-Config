#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-portability.'));
const config = path.join(fixture, 'codex', 'config.toml');
const rules = path.join(fixture, 'codex', 'rules');

try {
  fs.mkdirSync(rules, { recursive: true });
  fs.writeFileSync(config, 'model = "gpt-5"\n');
  fs.writeFileSync(
    path.join(rules, 'baseline.rules'),
    'allow = ["git status"]\n',
  );

  const clean = runCheck();
  assert.equal(clean.status, 0, clean.stderr || clean.stdout);
  assert.doesNotMatch(
    `${clean.stdout}${clean.stderr}`,
    /rg:|command not found/,
  );

  fs.writeFileSync(config, 'workspace = "/Users/example/private"\n');
  const forbidden = runCheck();
  assert.equal(forbidden.status, 1, forbidden.stderr || forbidden.stdout);
  assert.match(forbidden.stdout, /tracked Codex baseline/);

  fs.rmSync(config);
  const missing = runCheck();
  assert.equal(missing.status, 2, missing.stderr || missing.stdout);
  assert.match(missing.stderr, /target is missing/);
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}

console.log(
  '[OK] Codex portability checker is dependency-safe and fail-closed',
);

function runCheck() {
  return spawnSync(
    '/bin/bash',
    [path.join(root, 'scripts', 'check-codex-portability.sh')],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        GOLDBAND_CODEX_PORTABILITY_ROOT: fixture,
        PATH: '/usr/bin:/bin',
      },
    },
  );
}
