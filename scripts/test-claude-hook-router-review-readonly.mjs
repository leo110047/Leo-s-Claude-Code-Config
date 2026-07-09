#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const routerPath = path.join(
  repoDir,
  'hooks',
  'scripts',
  'hooks',
  'hook-router.js',
);
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-review-hook-'));

process.on('exit', () => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function runHook(sessionId, input) {
  return spawnSync(process.execPath, [routerPath], {
    cwd: repoDir,
    input: JSON.stringify({ session_id: sessionId, ...input }),
    encoding: 'utf8',
    env: {
      ...process.env,
      GOLDBAND_DATA_DIR: tmpDir,
      GOLDBAND_USAGE_FILE: path.join(tmpDir, 'usage-events.jsonl'),
    },
  });
}

function assertReviewReadOnlyActivation(label, toolInput) {
  const sessionId = `review-readonly-regression-${label}`;
  const invokeReview = runHook(sessionId, {
    hook_event_name: 'PreToolUse',
    tool_name: 'Skill',
    tool_input: toolInput,
  });
  assert.equal(invokeReview.status, 0, invokeReview.stderr);

  assertReviewMutationsBlocked(sessionId);
  assertReviewInspectionAllowed(sessionId);
  assertStopClearsReviewReadOnly(sessionId);
}

function assertReviewMutationsBlocked(sessionId) {
  const mutatingBash = runHook(sessionId, {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'touch review-mutates.txt' },
  });
  assert.equal(mutatingBash.status, 2, mutatingBash.stdout);
  assert.match(mutatingBash.stderr, /review-read-only is active/);
  assert.match(mutatingBash.stderr, /no-source-mutation|blocks touch/);

  const mutatingEdit = runHook(sessionId, {
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: {
      file_path: 'review-mutates.txt',
      old_string: 'before',
      new_string: 'after',
    },
  });
  assert.equal(mutatingEdit.status, 2, mutatingEdit.stdout);
  assert.match(
    mutatingEdit.stderr,
    /review-read-only allows source inspection only/,
  );

  const copyFromRuntimeToSource = runHook(sessionId, {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'cp /tmp/review-output package.json' },
  });
  assert.equal(
    copyFromRuntimeToSource.status,
    2,
    copyFromRuntimeToSource.stdout,
  );
  assert.match(copyFromRuntimeToSource.stderr, /blocks cp outside runtime/);
}

function assertReviewInspectionAllowed(sessionId) {
  const diffCommand = runHook(sessionId, {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: {
      command:
        'DIFF_BASE=$(git merge-base origin/main HEAD) && git diff "$DIFF_BASE" --stat | tail -1 | grep -oE "[0-9]+ insertion" || true',
    },
  });
  assert.equal(diffCommand.status, 0, diffCommand.stderr);

  const runtimeArtifactCommand = runHook(sessionId, {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: {
      command:
        'mkdir -p ~/.goldband/sessions && touch ~/.goldband/sessions/review',
    },
  });
  assert.equal(runtimeArtifactCommand.status, 0, runtimeArtifactCommand.stderr);
}

function assertStopClearsReviewReadOnly(sessionId) {
  const stop = runHook(sessionId, {
    hook_event_name: 'Stop',
  });
  assert.equal(stop.status, 0, stop.stderr);
  assert.match(stop.stderr, /review-read-only cleared/);

  const editAfterStop = runHook(sessionId, {
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: {
      file_path: 'review-mutates.txt',
      old_string: 'before',
      new_string: 'after',
    },
  });
  assert.equal(editAfterStop.status, 0, editAfterStop.stderr);
}

assertReviewReadOnlyActivation('goldband-name', { name: 'goldband-review' });
assertReviewReadOnlyActivation('short-name', { name: 'review' });
assertReviewReadOnlyActivation('skill-name-field', { skill_name: '/review' });
assertReviewReadOnlyActivation('skillName-field', { skillName: 'review' });

const nonReviewSession = 'review-readonly-regression-non-review';
const invokeShip = runHook(nonReviewSession, {
  hook_event_name: 'PreToolUse',
  tool_name: 'Skill',
  tool_input: { name: 'goldband-ship' },
});
assert.equal(invokeShip.status, 0, invokeShip.stderr);
const editAfterShip = runHook(nonReviewSession, {
  hook_event_name: 'PreToolUse',
  tool_name: 'Edit',
  tool_input: {
    file_path: 'ship-mutates.txt',
    old_string: 'before',
    new_string: 'after',
  },
});
assert.equal(editAfterShip.status, 0, editAfterShip.stderr);

console.log('[OK] Claude /review hook read-only enforcement verified');
