import { performance } from 'node:perf_hooks';
import type { WorkflowRunOptions } from './types';

type ReviewSpecialistMode = 'off' | 'auto' | 'all';

export type ReviewTimeoutPolicy = {
  specialistMode: ReviewSpecialistMode;
  hostTimeoutMs: number;
  passTimeoutMs: number;
};

export type ReviewTimeBudget = {
  policy: ReviewTimeoutPolicy;
  remainingPassTimeoutMs(): number;
  nextHostTimeoutMs(): number;
  assertWithinDeadline(): void;
  completeSpecialistPhase(): void;
};

export const DEFAULT_REVIEW_HOST_TIMEOUT_MS = 12 * 60 * 1000;
const MIN_REVIEW_TIMEOUT_MS = 60 * 1000;
const MAX_REVIEW_TIMEOUT_MS = 30 * 60 * 1000;

const DEFAULT_REVIEW_PASS_TIMEOUT_MS: Record<ReviewSpecialistMode, number> = {
  off: 12 * 60 * 1000,
  auto: 20 * 60 * 1000,
  all: 30 * 60 * 1000,
};

export function resolveReviewTimeoutPolicy(
  options: WorkflowRunOptions,
): ReviewTimeoutPolicy {
  const specialistMode = options.specialists ?? 'auto';
  const hostTimeoutMs = validatedTimeout(
    options.reviewHostTimeoutMs ?? DEFAULT_REVIEW_HOST_TIMEOUT_MS,
    '--review-host-timeout-seconds',
  );
  const passTimeoutMs = validatedTimeout(
    options.reviewPassTimeoutMs ?? DEFAULT_REVIEW_PASS_TIMEOUT_MS[specialistMode],
    '--review-pass-timeout-seconds',
  );
  if (hostTimeoutMs > passTimeoutMs) {
    throw new Error(
      '--review-host-timeout-seconds cannot exceed --review-pass-timeout-seconds',
    );
  }
  return { specialistMode, hostTimeoutMs, passTimeoutMs };
}

export function createReviewTimeBudget(
  options: WorkflowRunOptions,
  monotonicNow: () => number = performance.now.bind(performance),
  startedAtMonotonicMs?: number,
): ReviewTimeBudget {
  const policy = resolveReviewTimeoutPolicy(options);
  const deadlineAt = (startedAtMonotonicMs ?? monotonicNow()) + policy.passTimeoutMs;
  const timeoutError = () => new Error(
    `review/code ${policy.specialistMode} pass timed out after ${policy.passTimeoutMs}ms`,
  );
  const assertWithinDeadline = () => {
    if (monotonicNow() >= deadlineAt) {
      throw timeoutError();
    }
  };
  const remainingPassTimeoutMs = () => {
    const remaining = Math.floor(deadlineAt - monotonicNow());
    if (remaining <= 0) throw timeoutError();
    return remaining;
  };
  return {
    policy,
    remainingPassTimeoutMs,
    nextHostTimeoutMs() {
      return Math.min(policy.hostTimeoutMs, remainingPassTimeoutMs());
    },
    assertWithinDeadline,
    completeSpecialistPhase() {
      if (policy.specialistMode === 'all') assertWithinDeadline();
    },
  };
}

function validatedTimeout(value: number, flag: string): number {
  if (!Number.isInteger(value)) {
    throw new Error(`${flag} must resolve to a whole number of milliseconds`);
  }
  if (value < MIN_REVIEW_TIMEOUT_MS || value > MAX_REVIEW_TIMEOUT_MS) {
    throw new Error(`${flag} must be between 60 and 1800 seconds`);
  }
  return value;
}
