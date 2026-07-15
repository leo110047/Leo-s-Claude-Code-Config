import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getWorkflow } from '../workflows/registry';
import { runParallelSpecialistReview } from '../workflows/review-engine';

const ROOT = resolve(import.meta.dir, '..');

describe('review specialist dispatch', () => {
  test('dispatches every auto-matched specialist with bounded concurrency', async () => {
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    const findings = await runParallelSpecialistReview(
      workflowContext(),
      {
        name: 'mock' as const,
        capabilities: { readOnlyEnforced: true, parallelDispatch: true },
        async runJson() {
          calls += 1;
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
          active -= 1;
          return { text: '{"findings":[]}', parsed: { findings: [] } };
        },
      },
      [
        '+auth token check',
        '+schema migration',
        '+workflow host-adapter codex prompt',
        '+performance cache query',
      ].join('\n'),
      {},
    );

    expect(calls).toBe(4);
    expect(maxActive).toBeGreaterThan(1);
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(findings.every((finding) => finding.category !== 'host-capability')).toBe(true);
  });

  test('can inspect repository state outside the diff', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'review-code-unwired-'));
    try {
      writeFileSync(join(fixture, 'feature.ts'), 'export function newCapability() { return true; }\n');
      writeFileSync(join(fixture, 'registry.ts'), 'export const registeredCapabilities = ["existing"];\n');

      const findings = await runParallelSpecialistReview(
        workflowContext(fixture),
        {
          name: 'mock' as const,
          capabilities: { readOnlyEnforced: true, parallelDispatch: true },
          async runJson(prompt: string, _schema: unknown, cwd: string) {
            expect(cwd).toBe(fixture);
            expect(prompt).toContain('inspect the repository outside the diff');
            const registered = readFileSync(join(cwd, 'registry.ts'), 'utf8').includes('newCapability');
            const output = registered ? [] : [{
              file: 'registry.ts',
              line: 1,
              severity: 'high',
              category: 'correctness-contract',
              ruleId: 'architecture-boundaries',
              policySource: 'rules/architecture-boundaries.md',
              summary: 'The new capability is not registered.',
              failureScenario: 'The exported feature exists but no runtime consumer can reach it.',
              evidence: 'registry.ts contains only existing capability registration.',
              recommendation: 'Register newCapability in the authoritative registry.',
              suggestedVerification: 'Run the registry reachability test.',
              blocking: true,
              specialist: 'correctness-contract',
              contributingSpecialists: ['correctness-contract'],
            }];
            return { text: JSON.stringify({ findings: output }), parsed: { findings: output } };
          },
        },
        'diff --git a/feature.ts b/feature.ts\n+export function newCapability()',
        {},
        'all',
      );

      expect(findings.some((finding) => finding.ruleId === 'architecture-boundaries')).toBe(true);
      expect(findings.some((finding) => finding.summary.includes('not registered'))).toBe(true);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('honors explicit off mode without dispatch', async () => {
    let calls = 0;
    const findings = await runParallelSpecialistReview(
      { ...workflowContext(), options: { specialists: 'off' } },
      {
        name: 'mock' as const,
        capabilities: { readOnlyEnforced: false, parallelDispatch: false },
        async runJson() {
          calls += 1;
          return { text: '{"findings":[]}', parsed: { findings: [] } };
        },
      },
      '+auth token check',
      {},
      'off',
    );

    expect(calls).toBe(0);
    expect(findings).toEqual([]);
  });

  test('fails closed when the host lacks read-only or parallel capability', async () => {
    const noReadOnly = await runParallelSpecialistReview(
      workflowContext(),
      rejectingAdapter(false, true),
      '+auth token check',
      {},
    );
    expect(noReadOnly).toHaveLength(1);
    expect(noReadOnly[0].category).toBe('host-capability');
    expect(noReadOnly[0].evidence).toContain('read-only enforcement unavailable');

    const noParallel = await runParallelSpecialistReview(
      workflowContext(),
      rejectingAdapter(true, false),
      '+auth token check',
      {},
    );
    expect(noParallel[0].category).toBe('host-capability');
    expect(noParallel[0].evidence).toContain('parallel specialist dispatch unavailable');
  });

  test('reports rejected specialists as non-blocking runtime diagnostics', async () => {
    const findings = await runParallelSpecialistReview(
      workflowContext(),
      rejectingAdapter(true, true),
      '+workflow host-adapter codex prompt',
      {},
    );
    const failures = findings.filter((finding) => finding.category === 'specialist-runtime');
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.every((finding) => finding.severity === 'info' && !finding.blocking)).toBe(true);
    expect(failures[0].evidence).toContain('adapter crashed');
  });

  test('fails explicit all mode when exhaustive specialist coverage is incomplete', async () => {
    await expect(runParallelSpecialistReview(
      workflowContext(),
      rejectingAdapter(true, true),
      '+workflow host-adapter codex prompt',
      {},
      'all',
    )).rejects.toThrow(
      'Exhaustive specialist coverage incomplete: correctness-contract: adapter crashed',
    );
  });

  test('fails explicit all mode when the host cannot provide specialist capabilities', async () => {
    await expect(runParallelSpecialistReview(
      workflowContext(),
      rejectingAdapter(true, false),
      '+workflow host-adapter codex prompt',
      {},
      'all',
    )).rejects.toThrow('parallel specialist dispatch unavailable');
  });
});

function workflowContext(cwd = ROOT) {
  return {
    runId: 'test-run',
    workflow: getWorkflow('review/code'),
    cwd,
    options: {},
    artifacts: [],
  };
}

function rejectingAdapter(readOnlyEnforced: boolean, parallelDispatch: boolean) {
  return {
    name: 'mock' as const,
    capabilities: { readOnlyEnforced, parallelDispatch },
    async runJson() {
      throw new Error('adapter crashed');
    },
  };
}
