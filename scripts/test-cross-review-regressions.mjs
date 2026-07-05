#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const core = require('../goldband-loop/cross-review/core.cjs');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  assert.equal(
    result.status,
    options.expectStatus ?? 0,
    result.stderr || result.stdout,
  );
  return result;
}

function makeRepo(withPlan = true) {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'goldband-cross-review-reg-'),
  );
  run('git', ['init'], { cwd: dir });
  run('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  run('git', ['config', 'user.name', 'Test User'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'tracked.txt'), 'base\n');
  if (withPlan) fs.writeFileSync(path.join(dir, 'PLAN.md'), '# Plan\n');
  run('git', ['add', '.'], { cwd: dir });
  run('git', ['commit', '-m', 'base'], { cwd: dir });
  return dir;
}

function envFor(stateDir) {
  return {
    ...process.env,
    GOLDBAND_CROSS_REVIEW_DIR: stateDir,
    GOLDBAND_USAGE_FILE: path.join(stateDir, 'usage.jsonl'),
  };
}

function head(cwd) {
  return run('git', ['rev-parse', 'HEAD'], { cwd }).stdout.trim();
}

function createContract(dir, env, sessionId, overrides = {}) {
  return core.createContract(
    {
      sessionId,
      implementer: 'claude',
      reviewer: 'codex',
      planFile: 'PLAN.md',
      baseCommit: head(dir),
      cwd: dir,
      ...overrides,
    },
    env,
  );
}

function testChangesRequestedNeverRewritesToApproved() {
  const normalized = core.normalizeReviewResult(
    {
      verdict: 'CHANGES_REQUESTED',
      findings: [{ severity: 'HIGH', status: 'open' }],
    },
    1,
  );
  assert.equal(normalized.verdict, 'CHANGES_REQUESTED');
  assert.equal(normalized.blockingCount, 0);
}

function testMissingFindingsLineEscalates() {
  const dir = makeRepo();
  const stateDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'goldband-cross-review-state-'),
  );
  const env = envFor(stateDir);
  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-fake-bin-'));
  fs.writeFileSync(
    path.join(fakeBin, 'codex'),
    '#!/bin/sh\ncat >/dev/null\nprintf "%s\\n" "FAKE-CODEX-RAN"\nprintf "%s\\n" "GOLDBAND-CROSS-REVIEW-VERDICT: CHANGES_REQUESTED reviewer=codex round=1 blocking=1 advisory=0 artifact=fake"\n',
  );
  fs.chmodSync(path.join(fakeBin, 'codex'), 0o755);
  createContract(dir, env, 'missing-findings-line');
  const review = core.runReviewRound(
    { sessionId: 'missing-findings-line', cwd: dir },
    { ...env, PATH: `${fakeBin}${path.delimiter}${env.PATH}` },
  );
  assert.equal(review.artifact.verdict, 'ESCALATE');
  assert.equal(review.artifact.findings[0].id, 'CR-REVIEWER-PARSE');
  assert.match(
    fs.readFileSync(review.artifact.rawOutputPath, 'utf8'),
    /FAKE-CODEX-RAN/,
  );
}

function testApprovedWithBlockingFindingEscalates() {
  const normalized = core.normalizeReviewResult(
    {
      verdict: 'APPROVED',
      findings: [
        {
          severity: 'HIGH',
          ruleId: 'correctness.contract',
          failureScenario: 'Reviewer found a blocking contract failure.',
          status: 'open',
        },
      ],
    },
    1,
  );
  assert.equal(normalized.verdict, 'ESCALATE');
  assert.equal(normalized.blockingCount, 1);
}

function testNonZeroReviewerExitEscalates() {
  const dir = makeRepo();
  const stateDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'goldband-cross-review-state-'),
  );
  const env = envFor(stateDir);
  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-fake-bin-'));
  fs.writeFileSync(
    path.join(fakeBin, 'codex'),
    '#!/bin/sh\ncat >/dev/null\nprintf "%s\\n" "GOLDBAND-CROSS-REVIEW-VERDICT: APPROVED reviewer=codex round=1 blocking=0 advisory=0 artifact=fake"\nprintf "%s\\n" "GOLDBAND-CROSS-REVIEW-FINDINGS: []"\nexit 42\n',
  );
  fs.chmodSync(path.join(fakeBin, 'codex'), 0o755);
  createContract(dir, env, 'nonzero-reviewer-exit');
  const review = core.runReviewRound(
    { sessionId: 'nonzero-reviewer-exit', cwd: dir },
    { ...env, PATH: `${fakeBin}${path.delimiter}${env.PATH}` },
  );
  const planText = fs.readFileSync(path.join(dir, 'PLAN.md'), 'utf8');
  assert.equal(review.artifact.verdict, 'ESCALATE');
  assert.equal(review.artifact.reviewerExitCode, 42);
  assert.equal(review.artifact.findings[0].id, 'CR-REVIEWER-EXIT');
  assert.doesNotMatch(planText, /GOLDBAND-CROSS-REVIEW: APPROVED/);
}

function assertUntrackedPlanTextAllows(planText, suffix) {
  const dir = makeRepo(false);
  const stateDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'goldband-cross-review-state-'),
  );
  const env = envFor(stateDir);
  const sessionId = `untracked-plan-${suffix}`;
  fs.writeFileSync(path.join(dir, 'PLAN.md'), planText);
  createContract(dir, env, sessionId);
  const review = core.runReviewRound(
    { sessionId, reviewMode: 'mock', mockVerdict: 'APPROVED', cwd: dir },
    env,
  );
  const artifact = {
    ...review.artifact,
    reviewMode: 'real',
  };
  core.writeArtifact(artifact, 'real fixture output', env);
  core.writeContract(
    { ...core.readContract(sessionId, env), status: 'active' },
    env,
  );
  const gate = core.evaluateCrossReviewGate(
    { hook_event_name: 'Stop', session_id: sessionId },
    { cwd: dir, env },
  );
  assert.equal(gate.decision, 'allow', gate.logs.join('\n'));
}

function testUntrackedPlanMarkerRoundTripAllows() {
  assertUntrackedPlanTextAllows('# Plan\n', 'newline');
  assertUntrackedPlanTextAllows('# Plan', 'nonewline');
  assertUntrackedPlanTextAllows('# Plan\n\ncontent\n', 'content');
}

function testRoundTwoHighRegressionCanBlock() {
  const normalized = core.normalizeReviewResult(
    {
      verdict: 'CHANGES_REQUESTED',
      findings: [
        {
          id: 'CR-REG-HIGH',
          severity: 'HIGH',
          ruleId: 'regression.clear',
          failureScenario: 'Latest fix introduced a high-impact regression.',
          status: 'open',
        },
      ],
    },
    2,
    [{ findings: [] }],
  );
  assert.equal(normalized.findings[0].severity, 'HIGH');
  assert.equal(normalized.blockingCount, 1);
}

function testPromptArmDoesNotResetActiveContract() {
  const dir = makeRepo();
  const stateDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'goldband-cross-review-state-'),
  );
  const env = envFor(stateDir);
  const sessionId = 'rearm-active';
  const first = core.armFromPrompt(
    { session_id: sessionId, prompt: '開啟交互審查' },
    { cwd: dir, env, implementer: 'claude' },
  );
  core.writeContract({ ...first, roundsUsed: 2 }, env);
  const second = core.armFromPrompt(
    { session_id: sessionId, prompt: '開啟交互審查 --plan PLAN.md' },
    { cwd: dir, env, implementer: 'claude' },
  );
  const third = core.armFromPrompt(
    { session_id: sessionId, prompt: '開啟交互審查 --plan OTHER.md' },
    { cwd: dir, env, implementer: 'claude' },
  );
  assert.equal(second.roundsUsed, 2);
  assert.equal(third.roundsUsed, 2);
  assert.equal(third.planFile, 'PLAN.md');
  assert.equal(third.baseCommit, first.baseCommit);
}

function testQuotedTriggerTextDoesNotArm() {
  assert.equal(
    core.promptRequestsCrossReview('說明 `[[cross-review]]` 這個觸發詞'),
    false,
  );
  assert.equal(
    core.promptRequestsCrossReview('中文「開啟交互審查」只是文件範例'),
    false,
  );
  assert.equal(
    core.promptRequestsCrossReview(
      '請做這件事 [[cross-review]] --plan PLAN.md',
    ),
    true,
  );
  assert.equal(
    core.promptRequestsCrossReview('請開啟交互審查 --plan PLAN.md'),
    true,
  );
}

testChangesRequestedNeverRewritesToApproved();
testMissingFindingsLineEscalates();
testApprovedWithBlockingFindingEscalates();
testNonZeroReviewerExitEscalates();
testUntrackedPlanMarkerRoundTripAllows();
testRoundTwoHighRegressionCanBlock();
testPromptArmDoesNotResetActiveContract();
testQuotedTriggerTextDoesNotArm();

console.log('[OK] cross-review regression tests passed');
