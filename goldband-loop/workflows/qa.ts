import { qaCheckResultsSchema, qaChecksSchema } from './schema';
import type {
  EvaluationSignalSnapshot,
  QaCheck,
  QaCheckResult,
  WorkflowContext,
  WorkflowStep,
} from './types';

const MOCK_QA_CHECKS: QaCheck[] = [
  { id: 'home-smoke', label: 'Home route smoke check' },
  { id: 'primary-action', label: 'Primary action check' },
];

export const qaSteps: WorkflowStep[] = [
  { name: 'select-checks', kind: 'typed', produces: qaChecksSchema, run: selectChecks },
  { name: 'run-checks', kind: 'typed', produces: qaCheckResultsSchema, run: runChecks },
  { name: 'parse-check-results', kind: 'typed', produces: qaCheckResultsSchema, run: parseCheckResults },
];

export function qaSignalFromOutput(
  output: unknown,
  _ctx: WorkflowContext,
  stepName: string,
): EvaluationSignalSnapshot | undefined {
  if (!['run-checks', 'parse-check-results'].includes(stepName)) return undefined;
  return qaResultsSignal(qaCheckResultsSchema.validate(output));
}

export function qaTargetMet(signal: EvaluationSignalSnapshot): boolean {
  return signal.kind === 'qa-checks' && signal.failedCount === 0;
}

export function captureQaIterationState(
  output: unknown,
  _ctx: WorkflowContext,
  stepName: string,
) {
  if (stepName !== 'parse-check-results') return undefined;
  const results = qaCheckResultsSchema.validate(output);
  return { previousFailedChecks: results.filter((check) => check.status === 'fail') };
}

function selectChecks(ctx: WorkflowContext): QaCheck[] {
  if (ctx.options.mode === 'real') {
    throw new Error('qa/app typed adapter only supports mock mode; use the browser-backed qa/app contract for real QA');
  }
  const previousFailed = ctx.iterationContext?.previousFailedChecks;
  if (previousFailed?.length) return previousFailed.map(({ id, label }) => ({ id, label }));
  return MOCK_QA_CHECKS;
}

function runChecks(ctx: WorkflowContext): QaCheckResult[] {
  const checks = qaChecksSchema.validate(ctx.input);
  const retryingFailures = Boolean(ctx.iterationContext?.previousFailedChecks?.length);
  return checks.map((check) => mockResult(check, retryingFailures));
}

function parseCheckResults(ctx: WorkflowContext): QaCheckResult[] {
  return qaCheckResultsSchema.validate(ctx.input);
}

function mockResult(check: QaCheck, retryingFailures: boolean): QaCheckResult {
  if (!retryingFailures && check.id === 'primary-action') {
    return { ...check, status: 'fail', evidence: 'Mock first iteration failure.' };
  }
  return { ...check, status: 'pass', evidence: 'Mock check passed.' };
}

function qaResultsSignal(results: QaCheckResult[]): EvaluationSignalSnapshot {
  const failed = results.filter((check) => check.status === 'fail');
  return {
    kind: 'qa-checks',
    checkCount: results.length,
    passedCount: results.length - failed.length,
    failedCount: failed.length,
    failedCheckIds: failed.map((check) => check.id),
    blockerKey: failed.length ? failed.map((check) => check.id).sort().join('|') : undefined,
  };
}
