#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {
  ALLOWED_ACTIONS,
  ALLOWED_CATEGORIES,
  ALLOWED_CONFIDENCE,
  SCHEMA_VERSION,
  normalizeUsageEvent,
  resolveRunId,
  validateUsageEvent,
} = require('../scripts/lib/telemetry-schema.cjs');
const repoDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-schema-test-'));

process.on('exit', () => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function withEnv(updates, callback) {
  const previous = {};
  for (const key of Object.keys(updates)) {
    previous[key] = process.env[key];
    if (updates[key] === undefined) delete process.env[key];
    else process.env[key] = updates[key];
  }
  try {
    return callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function readJsonl(filePath) {
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function testPersistentRunIdFileFallback() {
  const runIdFile = path.join(tmpDir, 'run-id-marker', 'run-id.txt');
  const first = resolveRunId({}, { GOLDBAND_RUN_ID_FILE: runIdFile });
  const second = resolveRunId({}, { GOLDBAND_RUN_ID_FILE: runIdFile });

  assert.equal(first, second);
  assert.equal(fs.readFileSync(runIdFile, 'utf8').trim(), first);
}

function testEventRunIdPriorityUsesSharedResolver() {
  const fromSource = normalizeUsageEvent(
    { run_id: 'source-run' },
    { run_id: 'option-run', env: { GOLDBAND_RUN_ID: 'env-run' } },
  );
  const fromOption = normalizeUsageEvent(
    {},
    { run_id: 'option-run', env: { GOLDBAND_RUN_ID: 'env-run' } },
  );
  const fromEnvironment = normalizeUsageEvent(
    {},
    { env: { GOLDBAND_RUN_ID: 'env-run' } },
  );
  assert.equal(fromSource.run_id, 'source-run');
  assert.equal(fromOption.run_id, 'option-run');
  assert.equal(fromEnvironment.run_id, 'env-run');
}

function testValidatorMatchesJsonSchemaContract() {
  const schema = JSON.parse(
    fs.readFileSync(path.join(repoDir, 'schemas/telemetry.v1.schema.json')),
  );
  const validBase = {
    schema_version: SCHEMA_VERSION,
    run_id: 'run',
    event_id: 'event',
    category: 'workflow-entry',
    name: 'goldband-review',
    action: 'invoked',
    source: 'fixture',
    host: 'claude',
    detail: {},
    recordedAt: new Date().toISOString(),
  };

  for (const [event, expected] of [
    [{ ...validBase }, true],
    [{ ...validBase, host: undefined }, false],
    [{ ...validBase, detail: undefined }, false],
    [{ ...validBase, confidence: 'maybe' }, false],
  ]) {
    assert.equal(validateUsageEvent(event).valid, expected);
  }
  assert.deepEqual(schema.properties.category.enum, [...ALLOWED_CATEGORIES]);
  assert.deepEqual(schema.properties.action.enum, [...ALLOWED_ACTIONS]);
  assert.deepEqual(schema.properties.confidence.enum, [
    ...ALLOWED_CONFIDENCE,
    null,
  ]);
}

function testAppendUsageEventUsesRunIdMarkerFallback() {
  const {
    appendUsageEvent,
  } = require('../hooks/scripts/lib/hook-router/usage-telemetry.js');
  const runIdFile = path.join(tmpDir, 'append-run-id', 'run-id.txt');
  const usageFile = path.join(tmpDir, 'append-run-id', 'usage.jsonl');
  withEnv(
    {
      CLAUDE_SESSION_ID: undefined,
      CODEX_SESSION_ID: undefined,
      GOLDBAND_RUN_ID: undefined,
      GOLDBAND_RUN_ID_FILE: runIdFile,
      GOLDBAND_USAGE_FILE: usageFile,
    },
    () => {
      appendUsageEvent({ category: 'test', name: 'marker-fallback' });
      const event = readJsonl(usageFile).at(-1);
      assert.equal(event.run_id, fs.readFileSync(runIdFile, 'utf8').trim());
    },
  );
}

testPersistentRunIdFileFallback();
testEventRunIdPriorityUsesSharedResolver();
testValidatorMatchesJsonSchemaContract();
testAppendUsageEventUsesRunIdMarkerFallback();

console.log('[OK] telemetry schema behavior verified');
