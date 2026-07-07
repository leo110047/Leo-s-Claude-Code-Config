#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const tests = [
  ['selector files trigger selector parity', testSelectorParitySelection],
  ['hook config triggers hook reference check', testHookReferenceSelection],
  ['codex rules trigger portability check', testCodexPortabilitySelection],
  ['style gate files trigger self-test', testStyleGateSelection],
  ['unrelated files trigger no checks', testUnrelatedSelection],
];

for (const [name, test] of tests) {
  test();
  console.log(`ok - ${name}`);
}

function testSelectorParitySelection() {
  const result = dryRun(['codex/prompts/goldband.md']);
  assert.deepEqual(result.checks, ['selector-parity']);
}

function testHookReferenceSelection() {
  const result = dryRun(['hooks/hooks.json']);
  assert.deepEqual(result.checks, [
    'plugin-distribution',
    'hook-script-references',
  ]);
}

function testCodexPortabilitySelection() {
  const result = dryRun(['codex/rules/default.rules']);
  assert.deepEqual(result.checks, ['codex-portability']);
}

function testStyleGateSelection() {
  const result = dryRun(['scripts/lib/code-style/checks.mjs']);
  assert.deepEqual(result.checks, ['style-gate-self-test']);
}

function testUnrelatedSelection() {
  const result = dryRun(['docs/observability.md']);
  assert.deepEqual(result.checks, []);
}

function dryRun(files) {
  const result = spawnSync(
    process.execPath,
    [
      'scripts/check-goldband-project-style-gate.mjs',
      '--files',
      ...files,
      '--dry-run',
      '--format',
      'json',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
