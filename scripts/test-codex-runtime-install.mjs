#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-codex-install-'));
const env = { ...process.env, HOME: home };
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

const configResult = spawnSync('./install.sh', ['codex-config'], {
  cwd: process.cwd(),
  env,
  encoding: 'utf8',
});
assert.equal(
  configResult.status,
  0,
  configResult.stderr || configResult.stdout,
);

const profileFiles = fs
  .readdirSync(profileSourceRoot)
  .filter((entry) => entry.endsWith('.config.toml'));
assert.ok(profileFiles.length > 0, 'codex profile fixture inventory is empty');

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
