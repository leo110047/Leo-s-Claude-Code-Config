import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runPolicyCheck } from '../src/policy-check.js';

test('policy_check blocks foreground dev server via Claude policy', () => {
  const result = runPolicyCheck({ command: 'npm run dev' });

  assert.equal(result.structuredContent.outcome, 'block');
  assert.deepEqual(result.structuredContent.matchedRules, [
    'dev-server-blocker',
  ]);
  assert.equal(result.structuredContent.executed, false);
});

test('policy_check blocks unapproved markdown writes via Claude policy', () => {
  const result = runPolicyCheck({
    command: '',
    toolName: 'Write',
    filePath: 'notes/random.md',
    content: '# random',
  });

  assert.equal(result.structuredContent.outcome, 'block');
  assert.deepEqual(result.structuredContent.matchedRules, ['doc-file-blocker']);
});
