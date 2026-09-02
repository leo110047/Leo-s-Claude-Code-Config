import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createCandidateBinding,
  executeEvidencePlan,
  reviewEvidenceManifestSchema,
  type ReviewEvidenceManifest,
} from '../workflows/review-evidence';
import {
  commonSystemMachServices,
  darwinOutputChannelDenials,
  sealedEvidenceExecutionUnavailable,
  SYSTEM_SANDBOX_MACH_SERVICES,
  validateSystemSandboxMachServices,
} from '../workflows/review-evidence-sandbox';
import { getWorkflow } from '../workflows/registry';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('review evidence platform ownership', () => {
  test('sealed review evidence declares macOS-only support without guessing a fallback', () => {
    expect(sealedEvidenceExecutionUnavailable('darwin', true)).toBeUndefined();
    expect(sealedEvidenceExecutionUnavailable('darwin', false)).toEqual({
      actual: 'darwin/review-runtime',
      detail: 'the supported macOS Seatbelt executable is unavailable',
    });
    expect(sealedEvidenceExecutionUnavailable('linux', false)).toEqual({
      actual: 'linux/review-runtime',
      detail: 'sealed executable review evidence currently requires macOS Seatbelt; Linux and Windows review parity is not supported',
    });
    expect(sealedEvidenceExecutionUnavailable('win32', false)?.actual)
      .toBe('win32/review-runtime');
  });

  test('the imported macOS common Mach-service baseline fails closed on drift', () => {
    const baseline = sandboxBaselineFixture([...SYSTEM_SANDBOX_MACH_SERVICES]);
    expect(commonSystemMachServices(baseline)).toEqual([...SYSTEM_SANDBOX_MACH_SERVICES].sort());
    expect(() => validateSystemSandboxMachServices(baseline)).not.toThrow();
    expect(() => validateSystemSandboxMachServices(
      sandboxBaselineFixture([...SYSTEM_SANDBOX_MACH_SERVICES, 'com.apple.future-service']),
    )).toThrow('com.apple.future-service');
    expect(() => validateSystemSandboxMachServices(
      sandboxBaselineFixture(SYSTEM_SANDBOX_MACH_SERVICES.slice(1)),
    )).toThrow('com.apple.analyticsd');
    expect(() => validateSystemSandboxMachServices(
      baseline.replace('(allow mach-register (local-name-prefix ""))\n', ''),
    )).toThrow('mach-register');
    expect(() => validateSystemSandboxMachServices(
      baseline.replace('(allow mach-lookup (xpc-service-name-prefix ""))\n', ''),
    )).toThrow('xpc-service-name-prefix');
    expect(() => validateSystemSandboxMachServices(
      baseline.replace('  (allow mach-bootstrap)\n', ''),
    )).toThrow('mach-bootstrap');
    expect(darwinOutputChannelDenials()).toEqual(expect.arrayContaining([
      '(deny mach-lookup)',
      '(deny mach-register)',
      '(deny mach-bootstrap)',
      '(deny mach-register (local-name-prefix ""))',
      '(deny mach-lookup (xpc-service-name-prefix ""))',
    ]));
  });

  test('the current macOS system.sb matches the reviewed Mach-service baseline', () => {
    if (process.platform !== 'darwin') return;
    expect(() => validateSystemSandboxMachServices(readFileSync(
      '/System/Library/Sandbox/Profiles/system.sb',
      'utf8',
    ))).not.toThrow();
  });

  test('Linux sealed evidence returns typed incomplete records without semantic authority', async () => {
    if (process.platform !== 'linux') return;
    const repo = gitFixture();
    const value = manifest();
    value.providers[0]!.executionContext = { sandboxOwner: 'review-runtime', runner: 'sealed' };
    const validated = reviewEvidenceManifestSchema.validate(value);
    const input = { source: 'git diff', diff: '', changedFiles: [] };
    const evidence = await executeEvidencePlan(
      {
        runId: 'linux-platform-contract',
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
      environment: 'linux/review-runtime',
    });
    expect(evidence.records[0]!.outputSummary).toContain('Linux and Windows review parity is not supported');
    expect(evidence.completeness).toMatchObject({ complete: false, hostEligible: false });
  });

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

function sandboxBaselineFixture(services: readonly string[]): string {
  const conditional = new Set([
    'com.apple.internal.objc_trace',
    'com.apple.osanalytics.osanalyticshelper',
  ]);
  const commonServices = services.filter((service) => !conditional.has(service));
  return [
    '(version 3)',
    '(unless *import-path*',
    '  (allow mach-bootstrap)',
    '  (allow syscall*))',
    '(allow mach-register (local-name-prefix ""))',
    '(allow mach-lookup (xpc-service-name-prefix ""))',
    `(allow mach-lookup ${commonServices.map((service) =>
      `(global-name "${service}")`).join(' ')} (local-name "com.apple.cfprefsd.agent"))`,
    ...(services.includes('com.apple.internal.objc_trace')
      ? ['(allow mach-lookup (global-name "com.apple.internal.objc_trace"))']
      : []),
    ...(services.includes('com.apple.osanalytics.osanalyticshelper')
      ? ['(allow mach-lookup (global-name "com.apple.osanalytics.osanalyticshelper"))']
      : []),
    '(define (system-graphics) (allow default))',
  ].join('\n');
}

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
