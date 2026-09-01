import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createCandidateBinding,
  executeEvidencePlan,
  reviewEvidenceManifestSchema,
  type ReviewEvidenceManifest,
} from '../workflows/review-evidence';
import { getWorkflow } from '../workflows/registry';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('review evidence platform ownership', () => {
  test('an unsupported source lane remains typed runtime-incomplete without dispatching evidence', async () => {
    const repo = gitFixture();
    const value = manifest();
    const validated = reviewEvidenceManifestSchema.validate(value);
    const input = { source: 'git diff', diff: '', changedFiles: [] };
    const evidence = await executeEvidencePlan(
      {
        runId: 'platform-contract',
        workflow: getWorkflow('review/code'),
        cwd: repo,
        options: { mode: 'mock' as const },
        artifacts: [],
      },
      input,
      validated,
      createCandidateBinding(repo, input, validated),
    );

    expect(evidence.records[0]).toMatchObject({
      status: 'runtime-incomplete',
      fresh: false,
      environment: 'source/review-runtime',
    });
    expect(evidence.records[0]!.exitStatus).toBeUndefined();
    expect(evidence.records[0]!.outputSummary).toContain('actual=source/review-runtime');
    expect(evidence.completeness).toMatchObject({ complete: false, hostEligible: false });
  });
});

function gitFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'review-evidence-platform-'));
  roots.push(root);
  git(root, ['init']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['config', 'user.email', 'test@example.com']);
  writeFileSync(join(root, 'a.ts'), 'export const value = 1;\n');
  git(root, ['add', 'a.ts']);
  git(root, ['commit', '-m', 'fixture']);
  return root;
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout;
}

function manifest(): ReviewEvidenceManifest {
  return {
    schemaVersion: 2,
    behaviorMatrix: [{
      id: 'platform-contract',
      behavior: 'Only the installed macOS review host may execute provider evidence.',
      kind: 'boundary',
      input: 'source runtime invocation',
      preconditions: 'trusted installed launcher is absent',
      expected: 'the provider remains runtime-incomplete',
      risk: 'high',
      disposition: 'static',
      providerIds: ['host-provider'],
    }],
    providers: [{
      id: 'host-provider',
      owner: 'review-evidence-platform.test.ts',
      kind: 'static',
      lifecycle: 'persistent',
      cellIds: ['platform-contract'],
      applicability: { kind: 'global', reason: 'Explicit platform ownership contract.' },
      executionContext: {
        sandboxOwner: 'provider',
        runner: 'host-seatbelt',
        lane: 'macos-review-contract-host',
      },
      operations: [{
        id: 'must-not-run',
        target: 'candidate',
        argv: ['false'],
        expectedExit: 'zero',
        timeoutMs: 1_000,
        maxOutputBytes: 1_024,
        network: 'deny',
        evidenceLevel: 'fixture',
      }],
    }],
    authorizations: [],
  };
}
