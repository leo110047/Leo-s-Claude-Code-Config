/** Unit coverage for deterministic eval budget comparison helpers. */

import { describe, test, expect } from 'bun:test';
import {
  assertNoBudgetRegression,
  findBudgetRegressions,
  type ComparisonResult,
  type TestDelta,
} from './helpers/eval-store';

function makeDelta(
  name: string,
  beforeTools: Record<string, number>,
  afterTools: Record<string, number>,
  beforeTurns?: number,
  afterTurns?: number,
): TestDelta {
  return {
    name,
    before: { passed: true, cost_usd: 0, tool_summary: beforeTools, turns_used: beforeTurns },
    after: { passed: true, cost_usd: 0, tool_summary: afterTools, turns_used: afterTurns },
    status_change: 'unchanged',
  };
}

function makeComparison(deltas: TestDelta[]): ComparisonResult {
  return {
    before_file: '/tmp/before.json',
    after_file: '/tmp/after.json',
    before_branch: 'main',
    after_branch: 'feat/x',
    before_timestamp: '2025-01-01T00:00:00Z',
    after_timestamp: '2025-01-02T00:00:00Z',
    deltas,
    total_cost_delta: 0,
    total_duration_delta: 0,
    improved: 0,
    regressed: 0,
    unchanged: deltas.length,
    tool_count_before: 0,
    tool_count_after: 0,
  };
}

describe('findBudgetRegressions', () => {
  test('empty comparison → no regressions', () => {
    expect(findBudgetRegressions(makeComparison([]))).toEqual([]);
  });

  test('no regression when after ≤ 2× before for tools', () => {
    const comparison = makeComparison([
      makeDelta('a', { Bash: 10 }, { Bash: 19 }),
    ]);
    expect(findBudgetRegressions(comparison)).toEqual([]);
  });

  test('flags >2× tool growth', () => {
    const comparison = makeComparison([
      makeDelta('a', { Bash: 10, Read: 5 }, { Bash: 25, Read: 12 }),
    ]);
    const regressions = findBudgetRegressions(comparison);
    expect(regressions.length).toBe(1);
    expect(regressions[0]!.metric).toBe('tools');
    expect(regressions[0]!.before).toBe(15);
    expect(regressions[0]!.after).toBe(37);
  });

  test('flags >2× turn growth independently of tools', () => {
    const comparison = makeComparison([
      makeDelta('a', { Bash: 10 }, { Bash: 12 }, 5, 15),
    ]);
    const regressions = findBudgetRegressions(comparison);
    expect(regressions.length).toBe(1);
    expect(regressions[0]!.metric).toBe('turns');
  });

  test('skips tests with no prior tool data', () => {
    const comparison = makeComparison([
      makeDelta('new-test', {}, { Bash: 100 }),
    ]);
    expect(findBudgetRegressions(comparison)).toEqual([]);
  });

  test('skips when prior tool count is below the noise floor', () => {
    const comparison = makeComparison([
      makeDelta('tiny', { Bash: 1 }, { Bash: 4 }),
    ]);
    expect(findBudgetRegressions(comparison)).toEqual([]);
  });

  test('respects ratioCap override', () => {
    const comparison = makeComparison([
      makeDelta('a', { Bash: 10 }, { Bash: 16 }),
    ]);
    expect(findBudgetRegressions(comparison, { ratioCap: 1.5 }).length).toBe(1);
    expect(findBudgetRegressions(comparison, { ratioCap: 2 }).length).toBe(0);
  });

  test('respects GOLDBAND_BUDGET_RATIO env override', () => {
    const comparison = makeComparison([
      makeDelta('a', { Bash: 10 }, { Bash: 16 }),
    ]);
    const previous = process.env.GOLDBAND_BUDGET_RATIO;
    try {
      process.env.GOLDBAND_BUDGET_RATIO = '1.5';
      expect(findBudgetRegressions(comparison).length).toBe(1);
      process.env.GOLDBAND_BUDGET_RATIO = '2.0';
      expect(findBudgetRegressions(comparison).length).toBe(0);
    } finally {
      if (previous === undefined) delete process.env.GOLDBAND_BUDGET_RATIO;
      else process.env.GOLDBAND_BUDGET_RATIO = previous;
    }
  });

  test('handles missing tool_summary gracefully', () => {
    const delta: TestDelta = {
      name: 'sparse',
      before: { passed: true, cost_usd: 0 },
      after: { passed: true, cost_usd: 0 },
      status_change: 'unchanged',
    };
    expect(findBudgetRegressions(makeComparison([delta]))).toEqual([]);
  });
});

describe('assertNoBudgetRegression', () => {
  test('does not throw on a clean comparison', () => {
    const comparison = makeComparison([
      makeDelta('a', { Bash: 10 }, { Bash: 11 }),
    ]);
    expect(() => assertNoBudgetRegression(comparison)).not.toThrow();
  });

  test('throws with all violations and the cap value in the message', () => {
    const comparison = makeComparison([
      makeDelta('regressed-tools', { Bash: 10 }, { Bash: 30 }),
      makeDelta('regressed-turns', { Bash: 5 }, { Bash: 6 }, 4, 13),
    ]);
    let error: Error | null = null;
    try {
      assertNoBudgetRegression(comparison);
    } catch (caught) {
      error = caught as Error;
    }
    expect(error).not.toBeNull();
    expect(error!.message).toContain('regressed-tools');
    expect(error!.message).toContain('regressed-turns');
    expect(error!.message).toContain('2.00×');
    expect(error!.message).toContain('GOLDBAND_BUDGET_RATIO');
  });
});
