#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-codex-install-'));
const result = spawnSync('./install.sh', ['codex-hooks'], {
  cwd: process.cwd(),
  env: { ...process.env, HOME: home },
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

console.log('[OK] Codex runtime install tests passed');
