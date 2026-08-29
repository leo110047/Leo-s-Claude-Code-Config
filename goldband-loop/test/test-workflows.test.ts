import { describe, expect, test } from 'bun:test';
import {
  MACOS_REVIEW_HOST_TEST_NAMES,
  WORKFLOW_TESTS,
  testNamePatternForPlatform,
  workflowTestsForPlatform,
} from '../scripts/test-workflows';

describe('workflow test platform ownership', () => {
  test('Linux owns portable workflow contracts and never dispatches review-host tests', () => {
    const files = workflowTestsForPlatform();
    expect(files).toContain('test/review-evidence-platform.test.ts');
    expect(files).toContain('test/workflows-runtime.test.ts');
    expect(files).toContain('test/goldband-review-cli.test.ts');
    expect(files).toEqual([...WORKFLOW_TESTS]);
    const pattern = new RegExp(testNamePatternForPlatform('linux')!);
    for (const name of MACOS_REVIEW_HOST_TEST_NAMES) expect(pattern.test(name)).toBe(false);
    expect(pattern.test('workflow runtime > runtime rejects invocations outside manifest hostSupport'))
      .toBe(true);
  });

  test('macOS owns the complete workflow suite', () => {
    expect(workflowTestsForPlatform()).toEqual([...WORKFLOW_TESTS]);
    expect(testNamePatternForPlatform('darwin')).toBeUndefined();
  });
});
