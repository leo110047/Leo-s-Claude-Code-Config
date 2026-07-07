#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const core = require('../goldband-loop/cross-review/core.cjs');
const { validateUsageEvent } = require('../scripts/lib/telemetry-schema.cjs');
const routerPath = path.join(
  repoDir,
  'hooks',
  'scripts',
  'hooks',
  'hook-router.js',
);
const codexRouterPath = path.join(repoDir, 'codex', 'hooks', 'hook-router.js');
const crossReviewCliPath = path.join(
  repoDir,
  'goldband-loop',
  'cross-review',
  'cli.cjs',
);
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    ...options,
  });
  assert.equal(
    result.status,
    options.expectStatus ?? 0,
    result.stderr || result.stdout,
  );
  return result;
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-cross-review-'));
  run('git', ['init'], { cwd: dir });
  run('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  run('git', ['config', 'user.name', 'Test User'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'tracked.txt'), 'base\n');
  fs.writeFileSync(path.join(dir, 'PLAN.md'), '# Plan\n');
  run('git', ['add', '.'], { cwd: dir });
  run('git', ['commit', '-m', 'base'], { cwd: dir });
  return dir;
}

function testCanonicalHashCoversReviewScope() {
  const dir = makeRepo();
  const base = core.reviewedSha(
    dir,
    core.readContract('missing', {})?.baseCommit ||
      run('git', ['rev-parse', 'HEAD'], { cwd: dir }).stdout.trim(),
  );
  const head = run('git', ['rev-parse', 'HEAD'], { cwd: dir }).stdout.trim();
  const stableA = core.reviewedSha(dir, head);
  const stableB = core.reviewedSha(dir, head);
  assert.equal(stableA, stableB, 'same worktree hash should be stable');

  fs.appendFileSync(path.join(dir, 'tracked.txt'), 'unstaged\n');
  const trackedHash = core.reviewedSha(dir, head);
  assert.notEqual(
    trackedHash,
    base,
    'unstaged tracked content must affect hash',
  );

  run('git', ['add', 'tracked.txt'], { cwd: dir });
  const stagedHash = core.reviewedSha(dir, head);
  assert.equal(
    stagedHash,
    trackedHash,
    'staging the same content must not change canonical hash',
  );

  fs.writeFileSync(path.join(dir, 'untracked.txt'), 'new\n');
  const untrackedHash = core.reviewedSha(dir, head);
  assert.notEqual(
    untrackedHash,
    stagedHash,
    'untracked content must affect hash',
  );

  fs.writeFileSync(path.join(dir, 'binary.bin'), Buffer.from([0, 1, 2, 255]));
  const binaryHash = core.reviewedSha(dir, head);
  assert.notEqual(
    binaryHash,
    untrackedHash,
    'untracked binary content must affect hash',
  );

  fs.writeFileSync(path.join(dir, 'crlf.txt'), 'a\r\nb\r\n');
  const crlfHash = core.reviewedSha(dir, head);
  assert.notEqual(crlfHash, binaryHash, 'CRLF file bytes must affect hash');
}
function envFor(dir, stateDir) {
  return {
    ...process.env,
    GOLDBAND_CROSS_REVIEW_DIR: stateDir,
    GOLDBAND_USAGE_FILE: path.join(stateDir, 'usage.jsonl'),
  };
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
function runClaudeHook(input, dir, env, expectStatus = 0) {
  return spawnSync(process.execPath, [routerPath], {
    cwd: dir,
    input: JSON.stringify(input),
    encoding: 'utf8',
    env,
    maxBuffer: 10 * 1024 * 1024,
    expectStatus,
  });
}

function makeGateFixture(sessionId = 'session-a') {
  const dir = makeRepo();
  const stateDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'goldband-cross-review-state-'),
  );
  const env = envFor(dir, stateDir);
  const head = run('git', ['rev-parse', 'HEAD'], { cwd: dir }).stdout.trim();
  return { dir, env, head, sessionId };
}

function makeContractFixture(sessionId, overrides = {}) {
  const fixture = makeGateFixture(sessionId);
  core.createContract(
    {
      sessionId,
      implementer: 'claude',
      reviewer: 'codex',
      planFile: 'PLAN.md',
      baseCommit: fixture.head,
      cwd: fixture.dir,
      ...overrides,
    },
    fixture.env,
  );
  return fixture;
}

function assertUnarmedStopAllows(fixture) {
  const result = runClaudeHook(
    { hook_event_name: 'Stop', session_id: 'none' },
    fixture.dir,
    fixture.env,
  );
  assert.equal(result.status, 0, result.stderr);
}

function assertPlanMissingBlocks(fixture) {
  core.createContract(
    {
      sessionId: fixture.sessionId,
      implementer: 'claude',
      reviewer: 'codex',
      planFile: null,
      baseCommit: fixture.head,
      cwd: fixture.dir,
    },
    fixture.env,
  );
  const result = runClaudeHook(
    { hook_event_name: 'Stop', session_id: fixture.sessionId },
    fixture.dir,
    fixture.env,
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /尚未綁定 plan/);
}

function assertMarkerMissingBlocks(fixture) {
  core.writeContract(
    {
      ...core.readContract(fixture.sessionId, fixture.env),
      planFile: 'PLAN.md',
    },
    fixture.env,
  );
  const result = runClaudeHook(
    { hook_event_name: 'Stop', session_id: fixture.sessionId },
    fixture.dir,
    fixture.env,
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /交互審查閘門/);
  assert.match(result.stderr, /goldband-loop\/bin\/goldband-cross-review run/);
}

function assertArtifactMissingBlocks(fixture) {
  fs.appendFileSync(
    path.join(fixture.dir, 'PLAN.md'),
    '\n<!-- GOLDBAND-CROSS-REVIEW: APPROVED reviewer=codex implementer=claude\n     reviewed-sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa rounds=1\n     artifact=missing at=2026-07-05T00:00:00.000Z session=session-a -->\n',
  );
  const result = runClaudeHook(
    { hook_event_name: 'Stop', session_id: fixture.sessionId },
    fixture.dir,
    fixture.env,
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /找不到對應 reviewer artifact/);
}

function assertApprovalAllows(fixture) {
  fs.writeFileSync(path.join(fixture.dir, 'PLAN.md'), '# Plan\n');
  core.writeContract(
    {
      ...core.readContract(fixture.sessionId, fixture.env),
      status: 'active',
      roundsUsed: 0,
    },
    fixture.env,
  );
  const review = core.runReviewRound(
    {
      sessionId: fixture.sessionId,
      reviewMode: 'mock',
      mockVerdict: 'APPROVED',
      cwd: fixture.dir,
    },
    fixture.env,
  );
  assert.equal(review.artifact.verdict, 'APPROVED');
  assert.equal(review.artifact.reviewMode, 'mock');
  let result = runClaudeHook(
    { hook_event_name: 'Stop', session_id: fixture.sessionId },
    fixture.dir,
    fixture.env,
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /real review mode/);

  const realArtifact = {
    ...review.artifact,
    artifactId: 'real-approved-fixture',
    reviewMode: 'real',
    reviewerCommand: 'fixture-real-reviewer',
  };
  core.writeArtifact(realArtifact, 'fixture raw output', fixture.env);
  fs.appendFileSync(
    path.join(fixture.dir, 'PLAN.md'),
    `\n<!-- GOLDBAND-CROSS-REVIEW: APPROVED reviewer=codex implementer=claude\n     reviewed-sha=${realArtifact.reviewedSha} rounds=1\n     artifact=${realArtifact.artifactId} at=${realArtifact.createdAt} session=${fixture.sessionId} -->\n`,
  );
  core.writeContract(
    { ...core.readContract(fixture.sessionId, fixture.env), status: 'active' },
    fixture.env,
  );
  result = runClaudeHook(
    { hook_event_name: 'Stop', session_id: fixture.sessionId },
    fixture.dir,
    fixture.env,
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    core.readContract(fixture.sessionId, fixture.env).status,
    'passed',
  );
}

function assertShaMismatchBlocks(fixture) {
  core.writeContract(
    { ...core.readContract(fixture.sessionId, fixture.env), status: 'active' },
    fixture.env,
  );
  fs.appendFileSync(path.join(fixture.dir, 'tracked.txt'), 'after approval\n');
  const result = runClaudeHook(
    { hook_event_name: 'Stop', session_id: fixture.sessionId },
    fixture.dir,
    fixture.env,
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /通過後內容又變動/);
}

function assertOverrideAllows(fixture) {
  core.overrideContract(fixture.sessionId, 'test override', fixture.env);
  const result = runClaudeHook(
    { hook_event_name: 'Stop', session_id: fixture.sessionId },
    fixture.dir,
    fixture.env,
  );
  assert.equal(result.status, 0, result.stderr);
}

function testGateLifecycle() {
  const fixture = makeGateFixture();
  assertUnarmedStopAllows(fixture);
  assertPlanMissingBlocks(fixture);
  assertMarkerMissingBlocks(fixture);
  assertArtifactMissingBlocks(fixture);
  assertApprovalAllows(fixture);
  assertShaMismatchBlocks(fixture);
  assertOverrideAllows(fixture);
}

function testMaxRoundsAndRubricDowngrade() {
  const { dir, env, sessionId } = makeContractFixture('session-b', {
    maxRounds: 1,
  });

  const normalized = core.normalizeReviewResult(
    {
      verdict: 'CHANGES_REQUESTED',
      findings: [{ severity: 'HIGH', status: 'open' }],
    },
    1,
  );
  assert.equal(
    normalized.verdict,
    'CHANGES_REQUESTED',
    'reviewer CHANGES_REQUESTED must not be rewritten to APPROVED',
  );
  assert.equal(normalized.blockingCount, 0);

  core.writeContract(
    { ...core.readContract(sessionId, env), roundsUsed: 1 },
    env,
  );
  const result = runClaudeHook(
    { hook_event_name: 'Stop', session_id: sessionId },
    dir,
    env,
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /人類仲裁/);
}

function testRebuttalBoundaryKeepsAcceptedRebuttalsClosed() {
  const history = [
    {
      findings: [
        {
          id: 'CR-001',
          severity: 'HIGH',
          ruleId: 'correctness.contract',
          failureScenario: 'Existing blocker.',
          status: 'open',
        },
        {
          id: 'CR-002',
          severity: 'HIGH',
          ruleId: 'correctness.contract',
          failureScenario: 'Accepted rebuttal.',
          status: 'rebutted-accepted',
        },
      ],
    },
  ];
  const normalized = core.normalizeReviewResult(
    {
      verdict: 'CHANGES_REQUESTED',
      findings: [
        {
          id: 'CR-001',
          severity: 'HIGH',
          ruleId: 'correctness.contract',
          failureScenario: 'Still open.',
          status: 'open',
        },
        {
          id: 'CR-002',
          severity: 'HIGH',
          ruleId: 'correctness.contract',
          failureScenario: 'Reopened accepted rebuttal.',
          status: 'open',
        },
        {
          id: 'CR-NEW',
          severity: 'HIGH',
          ruleId: 'correctness.contract',
          failureScenario: 'New high-severity contract blocker.',
          status: 'open',
        },
        {
          id: 'CR-CRIT',
          severity: 'CRITICAL',
          ruleId: 'regression.clear',
          failureScenario: 'New critical regression.',
          status: 'open',
        },
      ],
    },
    2,
    history,
  );

  const byId = new Map(
    normalized.findings.map((finding) => [finding.id, finding]),
  );
  assert.equal(byId.get('CR-001').severity, 'HIGH');
  assert.equal(byId.get('CR-002').severity, 'MEDIUM');
  assert.equal(byId.get('CR-NEW').severity, 'HIGH');
  assert.equal(byId.get('CR-CRIT').severity, 'CRITICAL');
  assert.equal(normalized.blockingCount, 3);
}

function testImplementerResponsesEnterNextReviewerPrompt() {
  const { dir, env, sessionId } = makeContractFixture('session-responses');

  for (const response of ['fixed', 'rebutted', 'ask-human']) {
    core.appendResponse(
      sessionId,
      {
        findingId: `CR-${response}`,
        response,
        summary: `${response} summary`,
        evidence: [`evidence-${response}`],
      },
      env,
    );
  }
  fs.writeFileSync(
    path.join(dir, 'new-implementation.js'),
    'export const answer = 42;\n',
  );

  const prompt = core.buildReviewerPrompt(
    core.readContract(sessionId, env),
    dir,
    env,
  );
  assert.match(prompt, /fixed summary/);
  assert.match(prompt, /rebutted summary/);
  assert.match(prompt, /ask-human summary/);
  assert.match(prompt, /UNTRACKED new-implementation\.js/);
  assert.match(prompt, /export const answer = 42/);
}

function testCodexStopHardBlocksWithExitCode() {
  const { dir, env, sessionId } = makeContractFixture('codex-session', {
    implementer: 'codex',
    reviewer: 'claude',
  });
  const result = spawnSync(process.execPath, [codexRouterPath], {
    cwd: dir,
    input: JSON.stringify({ hook_event_name: 'Stop', session_id: sessionId }),
    encoding: 'utf8',
    env,
  });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /交互審查閘門/);
}

function testCliRunDoesNotClaimGatePassed() {
  const { dir, env, sessionId } = makeContractFixture('cli-status', {
    reviewerModel: 'gpt-5.5',
  });
  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-fake-bin-'));
  fs.writeFileSync(
    path.join(fakeBin, 'codex'),
    '#!/bin/sh\ncat >/dev/null\nprintf "%s\\n" "GOLDBAND-CROSS-REVIEW-VERDICT: APPROVED reviewer=codex reviewed-sha=fake round=1 blocking=0 advisory=0 artifact=fake"\nprintf "%s\\n" "GOLDBAND-CROSS-REVIEW-FINDINGS: []"\n',
  );
  fs.chmodSync(path.join(fakeBin, 'codex'), 0o755);

  const result = run(
    process.execPath,
    [crossReviewCliPath, 'run', '--session-id', sessionId],
    {
      cwd: dir,
      env: { ...env, PATH: `${fakeBin}${path.delimiter}${env.PATH}` },
    },
  );
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, 'approved-marker-written');
  assert.equal(output.artifact.reviewMode, 'real');
  assert.equal(output.artifact.reviewerModel, 'gpt-5.5');
  assert.match(output.artifact.reviewerCommand, /^codex exec/);
  assert.match(output.artifact.reviewerCommand, /--model gpt-5\.5/);
  assert.equal(core.readContract(sessionId, env).status, 'active');
}
function makeEscalationFixture() {
  const dir = makeRepo();
  const stateDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'goldband-cross-review-state-'),
  );
  const env = envFor(dir, stateDir);
  const sessionId = 'session-telemetry';
  const head = run('git', ['rev-parse', 'HEAD'], { cwd: dir }).stdout.trim();
  core.createContract(
    {
      sessionId,
      implementer: 'claude',
      reviewer: 'codex',
      planFile: 'PLAN.md',
      baseCommit: head,
      maxRounds: 1,
      cwd: dir,
    },
    env,
  );
  return { dir, env, sessionId };
}
function appendRebuttalResponse(sessionId, env) {
  core.appendResponse(
    sessionId,
    {
      findingId: 'CR-001',
      response: 'rebutted',
      summary: 'Evidence shows the contract is still valid.',
      evidence: ['PLAN.md'],
    },
    env,
  );
}
function assertEscalationStopBlocksWithSummary(dir, env, sessionId) {
  const stopResult = runClaudeHook(
    { hook_event_name: 'Stop', session_id: sessionId },
    dir,
    env,
  );
  assert.equal(stopResult.status, 2);
  assert.match(stopResult.stderr, /人類仲裁/);
  assert.match(stopResult.stderr, /session-telemetry-round-1-escalation\.md/);
}

function assertCrossReviewTelemetryEvents(env) {
  const events = readJsonl(env.GOLDBAND_USAGE_FILE);
  assert.ok(events.length > 0);
  for (const event of events) {
    assert.deepEqual(validateUsageEvent(event), { valid: true, errors: [] });
  }
  const eventNames = events.map((event) => event.name);
  assert.ok(eventNames.includes('cross-review-armed'));
  assert.ok(eventNames.includes('cross-review-response'));
  assert.ok(eventNames.includes('cross-review-round'));
  assert.ok(eventNames.includes('cross-review-escalation'));
  assert.ok(eventNames.includes('cross-review-override'));
}

function testEscalationSummaryAndTelemetry() {
  const { dir, env, sessionId } = makeEscalationFixture();
  appendRebuttalResponse(sessionId, env);
  const review = core.runReviewRound(
    {
      sessionId,
      reviewMode: 'mock',
      mockVerdict: 'CHANGES_REQUESTED',
      cwd: dir,
    },
    env,
  );
  const contract = core.readContract(sessionId, env);
  assert.equal(review.artifact.verdict, 'CHANGES_REQUESTED');
  assert.ok(contract.escalationSummaryPath);
  assert.ok(fs.existsSync(contract.escalationSummaryPath));
  assert.match(
    fs.readFileSync(contract.escalationSummaryPath, 'utf8'),
    /Implementer Responses/,
  );

  assertEscalationStopBlocksWithSummary(dir, env, sessionId);
  core.overrideContract(sessionId, 'human accepted risk', env);
  assertCrossReviewTelemetryEvents(env);
}

testCanonicalHashCoversReviewScope();
testGateLifecycle();
testMaxRoundsAndRubricDowngrade();
testRebuttalBoundaryKeepsAcceptedRebuttalsClosed();
testImplementerResponsesEnterNextReviewerPrompt();
testCodexStopHardBlocksWithExitCode();
testCliRunDoesNotClaimGatePassed();
testEscalationSummaryAndTelemetry();

console.log('[OK] cross-review gate tests passed');
