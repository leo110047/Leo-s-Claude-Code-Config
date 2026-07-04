import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runHealthCheck } from '../src/health-check.js';

test('health_check returns pass and fail rows from fixed allowlist', () => {
  const seen: string[][] = [];
  const result = runHealthCheck((spec) => {
    seen.push([spec.command, ...spec.args]);
    return {
      status: spec.id === 'decision-guidance' ? 1 : 0,
      stdout: spec.id,
      stderr: spec.id === 'decision-guidance' ? 'failed' : '',
    };
  });

  assert.equal(result.structuredContent.summary.passed, 3);
  assert.equal(result.structuredContent.summary.failed, 1);
  assert.equal(result.structuredContent.checks.at(-1)?.status, 'fail');
  assert.deepEqual(seen, [
    ['python3', 'scripts/check-json-toml-syntax.py'],
    ['python3', 'scripts/verify-hook-script-references.py'],
    ['node', 'scripts/check-goldband-loop-inventory.mjs'],
    ['bash', 'scripts/verify-decision-guidance.sh'],
  ]);
});
