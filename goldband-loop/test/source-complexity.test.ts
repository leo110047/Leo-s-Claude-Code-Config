import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import {
  baselineTransitionFailures,
  localPredecessorAuthority,
  summarizeDiagnostics,
  worsenedMetrics,
} from '../scripts/check-source-complexity';

describe('source complexity baseline', () => {
  test('normalizes per-file rule magnitudes independently of source line numbers', () => {
    const baseline = summarizeDiagnostics([
      diagnostic('workflows/review.ts', 'complexity/useMaxParams', 7),
      diagnostic('workflows/review.ts', 'complexity/useMaxParams', 5),
      diagnostic('workflows/review.ts', 'complexity/noExcessiveLinesPerFunction', 80),
    ]);
    expect(baseline.files['workflows/review.ts']).toEqual({
      'lint/complexity/noExcessiveLinesPerFunction': [80],
      'lint/complexity/useMaxParams': [7, 5],
    });
  });

  test('rejects a worsened sorted magnitude vector and permits aggregate reduction', () => {
    const expected = summarizeDiagnostics([
      diagnostic('workflows/review.ts', 'complexity/useMaxParams', 7),
      diagnostic('workflows/review.ts', 'complexity/useMaxParams', 5),
    ]);
    const improved = summarizeDiagnostics([
      diagnostic('workflows/review.ts', 'complexity/useMaxParams', 6),
    ]);
    const worsened = summarizeDiagnostics([
      diagnostic('workflows/review.ts', 'complexity/useMaxParams', 8),
    ]);
    const newFile = summarizeDiagnostics([
      diagnostic('workflows/new.ts', 'complexity/useMaxParams', 5),
    ]);

    expect(worsenedMetrics(expected, improved)).toEqual([]);
    expect(worsenedMetrics(expected, worsened)).toHaveLength(1);
    expect(worsenedMetrics(expected, newFile)).toHaveLength(1);
  });

  test('documents that ranked vectors do not carry function identity', () => {
    const predecessor = summarizeDiagnostics([
      diagnostic('workflows/review.ts', 'complexity/noExcessiveLinesPerFunction', 100),
      diagnostic('workflows/review.ts', 'complexity/noExcessiveLinesPerFunction', 60),
    ]);
    const aggregateReduction = summarizeDiagnostics([
      diagnostic('workflows/review.ts', 'complexity/noExcessiveLinesPerFunction', 90),
    ]);

    expect(worsenedMetrics(predecessor, aggregateReduction)).toEqual([]);
  });

  test('rejects a hand-expanded candidate baseline even when it matches source', () => {
    const predecessor = summarizeDiagnostics([
      diagnostic('workflows/review.ts', 'complexity/useMaxParams', 5),
    ]);
    const expandedCandidate = summarizeDiagnostics([
      diagnostic('workflows/review.ts', 'complexity/useMaxParams', 7),
    ]);

    expect(baselineTransitionFailures(
      predecessor,
      expandedCandidate,
      expandedCandidate,
    )).toEqual([
      expect.stringContaining('candidate baseline exceeds predecessor'),
    ]);
  });

  test('uses the baseline-changing commit parent across later unrelated commits', () => {
    const candidate = summarizeDiagnostics([
      diagnostic('workflows/review.ts', 'complexity/useMaxParams', 7),
    ]);

    expect(localPredecessorAuthority(candidate, candidate, 'baseline-change-a'))
      .toEqual({ ref: 'baseline-change-a^', required: true });
    expect(localPredecessorAuthority(
      candidate,
      summarizeDiagnostics([]),
      'older-change',
    )).toEqual({ ref: 'HEAD', required: true });
    expect(localPredecessorAuthority(candidate, undefined, undefined))
      .toEqual({ ref: 'HEAD', required: false });
  });

  test('fails closed when the configured predecessor ref is unavailable', () => {
    const result = spawnSync(
      process.execPath,
      [join(import.meta.dir, '../scripts/check-source-complexity.ts')],
      {
        cwd: join(import.meta.dir, '..'),
        encoding: 'utf8',
        env: {
          ...process.env,
          GOLDBAND_COMPLEXITY_BASE_REF: 'definitely-not-a-complexity-ref',
        },
      },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      'required complexity predecessor is unavailable: definitely-not-a-complexity-ref',
    );
  });
});

function diagnostic(path: string, rule: string, value: number) {
  return {
    category: `lint/${rule}`,
    message: `metric ${value}`,
    location: { path, start: { line: 1, column: 1 } },
  };
}
