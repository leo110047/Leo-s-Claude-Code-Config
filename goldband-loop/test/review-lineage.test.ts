import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { getWorkflow } from '../workflows/registry';
import { runWorkflow } from '../workflows/runtime';
import {
  finalizeClosureReviewLineage,
  finalizeInitialReviewLineage,
  prepareReviewLineage,
  readReviewLineageForTest,
  releaseReviewLineage,
  reviewLineageScopeDigest,
} from '../workflows/review-lineage';
import type {
  InitialReviewArtifact,
  ReviewEvidenceManifest,
} from '../workflows/review-evidence';
import { createCandidateBinding } from '../workflows/review-evidence';

const roots: string[] = [];
const key = Buffer.alloc(32, 7);

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('authoritative review lineage', () => {
  test('workflow rejects laundering before evidence or a second semantic host dispatch', async () => {
    const fixture = repository();
    const diffFile = join(fixture.repo, 'candidate.diff');
    const evidenceFile = join(fixture.repo, 'goldband.review-evidence.json');
    writeFileSync(diffFile, [
      'diff --git a/deploy.ts b/deploy.ts',
      '--- a/deploy.ts',
      '+++ b/deploy.ts',
      '@@ -1 +1 @@',
      '-safe();',
      '+GOLDBAND_HIGH_SEMANTIC_FIXTURE();',
      '',
    ].join('\n'));
    const original = dispositionManifest('unsafe deployment is rejected');
    writeFileSync(evidenceFile, `${JSON.stringify(original)}\n`);
    git(fixture.repo, ['add', 'goldband.review-evidence.json']);
    git(fixture.repo, ['commit', '-qm', 'add review evidence']);
    const initial = await runWorkflow(getWorkflow('review/code'), {
      mode: 'mock', host: 'mock', cwd: fixture.repo, goldbandHome: fixture.state,
      diffFile: 'candidate.diff', evidenceManifestFile: 'goldband.review-evidence.json',
    });
    expect(String(initial.output)).toContain('prior-blockers-open: true');
    expect(String(initial.output)).toContain('completion-authorized: false');

    const weakened = dispositionManifest('the unsafe graph remains installed');
    writeFileSync(evidenceFile, `${JSON.stringify(weakened)}\n`);
    await expect(runWorkflow(getWorkflow('review/code'), {
      mode: 'mock', host: 'mock', cwd: fixture.repo, goldbandHome: fixture.state,
      diffFile: 'candidate.diff', evidenceManifestFile: 'goldband.review-evidence.json',
    })).rejects.toThrow('prior findings/blockers open');
    const telemetryRoot = join(fixture.state, 'workflow-runs', 'telemetry');
    const hostTelemetry = spawnSync('find', [telemetryRoot, '-name', '*-review-host-usage.json'], { encoding: 'utf8' });
    expect(hostTelemetry.stdout.trim().split('\n').filter(Boolean)).toHaveLength(1);
  });

  test('blocks a weakened manifest before another initial review can run', () => {
    const fixture = repository();
    const first = prepare(fixture, manifest());
    const artifact = initialArtifact(manifest(), [{
      id: 'S-001',
      file: 'deploy.ts',
      severity: 'high',
      summary: 'unsafe deployment gate',
      blocking: true,
      behaviorCellIds: ['deployment-safe'],
    }]);
    finalizeInitialReviewLineage({
      handle: first,
      key,
      repository: 'repo',
      baseDigest: 'a'.repeat(64),
      scopeDigest: 'b'.repeat(64),
      artifact,
      artifactFile: join(fixture.state, 'initial.json'),
      findings: artifact.findings,
      deterministicComplete: true,
      runtimeIncomplete: false,
    });
    releaseReviewLineage(first);

    const weak = manifest();
    weak.behaviorMatrix[0]!.expected = 'the unsafe graph remains installed';
    expect(() => prepare(fixture, weak)).toThrow('prior findings/blockers open');
    const persisted = readReviewLineageForTest(first.file, key)!;
    expect(persisted.unresolvedFindings.map((item) => item.findingId)).toEqual(['S-001']);
    expect(persisted.verdict).toMatchObject({
      priorBlockersOpen: true,
      completionAuthorized: false,
    });
  });

  test('detects all inherited contract downgrade classes and permits additive coverage', () => {
    const fixture = repository();
    const first = prepare(fixture, manifest());
    const artifact = initialArtifact(manifest(), []);
    finalizeInitialReviewLineage({
      handle: first,
      key,
      repository: 'repo',
      baseDigest: 'a'.repeat(64),
      scopeDigest: 'b'.repeat(64),
      artifact,
      artifactFile: join(fixture.state, 'clean.json'),
      findings: [],
      deterministicComplete: true,
      runtimeIncomplete: false,
    });
    releaseReviewLineage(first);

    const mutations: Array<(value: ReviewEvidenceManifest) => void> = [
      (value) => { value.behaviorMatrix = []; },
      (value) => { value.behaviorMatrix[0]!.expected = 'unsafe state is accepted'; },
      (value) => { value.behaviorMatrix[0]!.risk = 'low'; },
      (value) => { value.behaviorMatrix[0]!.disposition = 'manual'; value.behaviorMatrix[0]!.reason = 'skip'; },
      (value) => { value.providers[0]!.operations[0]!.argv = ['true']; },
      (value) => { value.providers[0]!.operations[0]!.evidenceLevel = 'fixture'; },
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(manifest());
      mutate(changed);
      expect(() => prepare(fixture, changed)).toThrow('contract laundering blocked');
    }

    const additive = structuredClone(manifest());
    additive.behaviorMatrix.push({
      id: 'extra-coverage',
      behavior: 'extra invariant',
      kind: 'boundary',
      input: 'edge',
      preconditions: 'candidate exists',
      expected: 'edge remains safe',
      risk: 'medium',
      disposition: 'static',
      providerIds: ['extra-provider'],
    });
    additive.providers.push({
      id: 'extra-provider',
      owner: 'project',
      kind: 'static',
      cellIds: ['extra-coverage'],
      changedPathPrefixes: [],
      operations: [operation('extra-check', 'local')],
    });
    const next = prepare(fixture, additive);
    expect(next.appliedWaiverIds).toEqual([]);
    releaseReviewLineage(next);
  });

  test('canonicalizes replaced diff-file paths and rejects an exact duplicate initial identity', () => {
    const fixture = repository();
    const value = manifest();
    const left = createCandidateBinding(fixture.repo, {
      source: `diff-file:${join(fixture.repo, 'first.diff')}`,
      diff: 'same diff',
      changedFiles: ['deploy.ts'],
    }, value);
    const right = createCandidateBinding(fixture.repo, {
      source: `diff-file:${join(fixture.repo, 'replacement.diff')}`,
      diff: 'same diff',
      changedFiles: ['deploy.ts'],
    }, value);
    expect(left.scopeDigest).toBe(right.scopeDigest);

    const first = prepare(fixture, value);
    const artifact = initialArtifact(value, []);
    finalizeInitialReviewLineage({
      handle: first, key, repository: 'repo', baseDigest: 'a'.repeat(64), scopeDigest: 'b'.repeat(64),
      artifact, artifactFile: join(fixture.state, 'clean.json'), findings: [],
      deterministicComplete: true, runtimeIncomplete: false,
    });
    releaseReviewLineage(first);
    expect(() => prepare(fixture, value)).toThrow('duplicate initial review identity');
  });

  test('keeps distinct Work Map ticket authorities in independent lineages', () => {
    const candidateScope = 'b'.repeat(64);
    const first = reviewLineageScopeDigest(candidateScope, { workId: 'work-a', ticketId: 'ticket-a' });
    const second = reviewLineageScopeDigest(candidateScope, { workId: 'work-a', ticketId: 'ticket-b' });
    expect(first).not.toBe(second);
    expect(reviewLineageScopeDigest(candidateScope)).toBe(candidateScope);
  });

  test('requires the authoritative artifact and closes blockers only through scoped closure', () => {
    const fixture = repository();
    const first = prepare(fixture, manifest());
    const artifact = initialArtifact(manifest(), [{
      id: 'S-001', file: 'deploy.ts', severity: 'high', summary: 'unsafe',
      blocking: true, behaviorCellIds: ['deployment-safe'],
    }]);
    const artifactFile = join(fixture.state, 'initial.json');
    finalizeInitialReviewLineage({
      handle: first, key, repository: 'repo', baseDigest: 'a'.repeat(64), scopeDigest: 'b'.repeat(64),
      artifact, artifactFile, findings: artifact.findings,
      deterministicComplete: true, runtimeIncomplete: false,
    });
    releaseReviewLineage(first);

    expect(() => prepare(fixture, manifest(), { ...artifact, runId: 'forged' })).toThrow(
      'not the authoritative unresolved finding lineage',
    );
    const closure = prepare(fixture, manifest(), artifact);
    const verdict = finalizeClosureReviewLineage({
      handle: closure,
      key,
      results: [{ findingId: 'S-001', status: 'closed', summary: 'fixed', evidenceIds: ['gate:check'] }],
      deterministicComplete: true,
      runtimeIncomplete: false,
    });
    expect(verdict).toMatchObject({
      priorBlockersOpen: false,
      closureComplete: true,
      completionAuthorized: true,
    });
    releaseReviewLineage(closure);
  });

  test('rejects concurrent owners, recovers a dead owner, and detects tampering', () => {
    const fixture = repository();
    const first = prepare(fixture, manifest());
    expect(() => prepare(fixture, manifest())).toThrow('already owned');
    const stale = new Date(Date.now() - 11 * 60 * 1000);
    utimesSync(first.lockFile, stale, stale);
    expect(() => prepare(fixture, manifest())).toThrow('already owned');
    releaseReviewLineage(first);
    writeFileSync(first.lockFile, `${JSON.stringify({ pid: 999_999_999 })}\n`, { mode: 0o600 });
    writeFileSync(`${first.lockFile}.recovery`, `${JSON.stringify({ pid: process.pid })}\n`, { mode: 0o600 });
    expect(() => prepare(fixture, manifest())).toThrow('recovery is already owned');
    writeFileSync(
      `${first.lockFile}.recovery`,
      `${JSON.stringify({ pid: 999_999_999, runId: 'crashed-recovery' })}\n`,
    );
    const recovered = prepare(fixture, manifest());
    releaseReviewLineage(first);
    expect(() => prepare(fixture, manifest())).toThrow('already owned');
    releaseReviewLineage(recovered);
    const artifact = initialArtifact(manifest(), []);
    finalizeInitialReviewLineage({
      handle: recovered, key, repository: 'repo', baseDigest: 'a'.repeat(64), scopeDigest: 'b'.repeat(64),
      artifact, artifactFile: join(fixture.state, 'clean.json'), findings: [],
      deterministicComplete: true, runtimeIncomplete: false,
    });
    const signed = JSON.parse(readFileSync(recovered.file, 'utf8'));
    signed.verdict.completionAuthorized = false;
    writeFileSync(recovered.file, `${JSON.stringify(signed)}\n`, { mode: 0o600 });
    expect(() => readReviewLineageForTest(recovered.file, key)).toThrow('tampered');
  });

  test('enforces base-owned minimum evidence and records a typed base-owned waiver', () => {
    const policy = {
      schemaVersion: 1,
      policyId: 'project-review-v1',
      minimumEvidenceLevels: [{
        id: 'deployment-live',
        cellIds: ['deployment-safe'],
        minimumLevel: 'live-provider',
        reason: 'deployment requires live provider evidence',
      }],
      waivers: [{
        id: 'approved-risk-change',
        cellId: 'deployment-safe',
        allowedChanges: ['risk'],
        reason: 'owner reclassified this scoped contract',
        approvedBy: 'project-owner',
        approvedAt: '2026-08-01T00:00:00.000Z',
        expiresAt: '2027-08-01T00:00:00.000Z',
      }],
    };
    const fixture = repository(policy);
    const insufficient = manifest();
    insufficient.providers[0]!.operations[0]!.evidenceLevel = 'local';
    expect(() => prepare(fixture, insufficient)).toThrow('requires live-provider');

    const original = manifest();
    original.providers[0]!.operations[0]!.evidenceLevel = 'live-provider';
    original.providers[0]!.operations[0]!.network = 'authorized';
    original.providers[0]!.operations[0]!.authorizationId = 'live-auth';
    original.authorizations.push({
      id: 'live-auth', operation: 'gate:check', scope: 'fixture', approvedBy: 'owner',
      approvedAt: '2026-08-01T00:00:00.000Z', expiresAt: '2027-08-01T00:00:00.000Z',
    });
    const first = prepare(fixture, original);
    const artifact = initialArtifact(original, []);
    finalizeInitialReviewLineage({
      handle: first, key, repository: 'repo', baseDigest: 'a'.repeat(64), scopeDigest: 'b'.repeat(64),
      artifact, artifactFile: join(fixture.state, 'clean.json'), findings: [],
      deterministicComplete: true, runtimeIncomplete: false,
    });
    releaseReviewLineage(first);
    const reclassified = structuredClone(original);
    reclassified.behaviorMatrix[0]!.risk = 'medium';
    const next = prepare(fixture, reclassified);
    expect(next.appliedWaiverIds).toEqual(['approved-risk-change']);
    const waivedArtifact = initialArtifact(reclassified, []);
    finalizeInitialReviewLineage({
      handle: next, key, repository: 'repo', baseDigest: 'a'.repeat(64), scopeDigest: 'b'.repeat(64),
      artifact: waivedArtifact, artifactFile: join(fixture.state, 'waived.json'), findings: [],
      deterministicComplete: true, runtimeIncomplete: false,
    });
    expect(readReviewLineageForTest(next.file, key)?.appliedWaiverIds)
      .toEqual(['approved-risk-change']);
    releaseReviewLineage(next);
  });
});

function repository(policy?: object) {
  const root = mkdtempSync(join(tmpdir(), 'review-lineage-'));
  roots.push(root);
  const repo = join(root, 'repo');
  const state = join(root, 'state');
  mkdirSync(repo);
  mkdirSync(state);
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test']);
  writeFileSync(join(repo, 'README.md'), 'fixture\n');
  if (policy) writeFileSync(join(repo, 'goldband.review-policy.json'), `${JSON.stringify(policy)}\n`);
  git(repo, ['add', '.']);
  git(repo, ['commit', '-qm', 'fixture']);
  return { repo, state };
}

function prepare(
  fixture: ReturnType<typeof repository>,
  evidenceManifest: ReviewEvidenceManifest,
  closureArtifact?: InitialReviewArtifact,
) {
  return prepareReviewLineage({
    cwd: fixture.repo,
    storeRoot: fixture.state,
    key,
    repository: 'repo',
    baseRef: 'HEAD',
    baseDigest: 'a'.repeat(64),
    scopeDigest: 'b'.repeat(64),
    acceptanceDigest: 'c'.repeat(64),
    policyIdentityDigest: 'd'.repeat(64),
    candidateDigest: 'e'.repeat(64),
    behaviorContractDigest: createHash('sha256').update(JSON.stringify(evidenceManifest)).digest('hex'),
    manifest: evidenceManifest,
    closureArtifact,
    runId: crypto.randomUUID(),
  });
}

function manifest(): ReviewEvidenceManifest {
  return {
    schemaVersion: 1,
    behaviorMatrix: [{
      id: 'deployment-safe',
      behavior: 'deployment rejects an unsafe dependency graph',
      kind: 'boundary',
      input: 'candidate graph',
      preconditions: 'deployment gate is active',
      expected: 'unsafe graph is rejected',
      risk: 'high',
      disposition: 'runtime-readback',
      providerIds: ['gate'],
    }],
    providers: [{
      id: 'gate',
      owner: 'project',
      kind: 'runtime-integration',
      cellIds: ['deployment-safe'],
      changedPathPrefixes: [],
      operations: [operation('check', 'sandboxed-service')],
    }],
    authorizations: [],
  };
}

function dispositionManifest(expected: string): ReviewEvidenceManifest {
  return {
    schemaVersion: 1,
    behaviorMatrix: [{
      id: 'deployment-safe',
      behavior: 'deployment rejects an unsafe dependency graph',
      kind: 'boundary',
      input: 'candidate graph',
      preconditions: 'deployment gate is active',
      expected,
      risk: 'high',
      disposition: 'not-applicable',
      providerIds: [],
      reason: 'semantic-only workflow fixture',
    }],
    providers: [],
    authorizations: [],
  };
}

function operation(id: string, evidenceLevel: 'fixture' | 'local' | 'sandboxed-service' | 'live-provider') {
  return {
    id,
    target: 'candidate' as const,
    argv: ['node', '--version'],
    expectedExit: 'zero' as const,
    timeoutMs: 1000,
    maxOutputBytes: 1024,
    network: 'deny' as const,
    evidenceLevel,
    requiredSystemTools: [],
  };
}

function initialArtifact(
  evidenceManifest: ReviewEvidenceManifest,
  findings: InitialReviewArtifact['findings'],
): InitialReviewArtifact {
  const behaviorContractDigest = createHash('sha256')
    .update(JSON.stringify(evidenceManifest))
    .digest('hex');
  return {
    schemaVersion: 1,
    phase: 'initial',
    runId: 'initial-run',
    binding: {
      repository: 'repo', baseRef: 'HEAD', baseDigest: 'a'.repeat(64),
      candidateDigest: 'e'.repeat(64), scopeDigest: 'b'.repeat(64),
      behaviorContractDigest, changedFiles: ['deploy.ts'], redactedUntrackedFiles: [],
    },
    diff: 'diff',
    evidence: {
      schemaVersion: 1,
      manifest: evidenceManifest,
      binding: {} as InitialReviewArtifact['binding'],
      records: [],
      completeness: { complete: true, hostEligible: true, blockingCellIds: [], coverageGapCellIds: [], runtimeIncompleteCellIds: [] },
      manifestSource: 'fixture',
    },
    findings,
    hostCallCount: 1,
    createdAt: '2026-08-27T00:00:00.000Z',
    runtimeReceipt: {
      schemaVersion: 1, id: 'receipt-1', digest: '1'.repeat(64), signature: '2'.repeat(64), reviewScope: { kind: 'standalone' },
    },
  };
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
