import { buildEvidenceEvent, writeEvidence } from './evidence';
import { executeWorkflowPass, type WorkflowRunResult } from './runtime';
import type {
  EvaluationSignalSnapshot,
  IterationContext,
  SignalTrailEntry,
  StopHistoryEntry,
  StopPredicateName,
  WorkflowDefinition,
  WorkflowRunOptions,
} from './types';

export type StopDecision = {
  matched: boolean;
  condition: StopPredicateName;
  reason: string;
};

export type WorkflowLoopResult = WorkflowRunResult & {
  iterationCount: number;
  stopReason: string;
  signalTrail: SignalTrailEntry[];
  stopHistory: StopHistoryEntry[];
};

export async function runWorkflowLoop(
  workflow: WorkflowDefinition,
  options: WorkflowRunOptions = {},
): Promise<WorkflowLoopResult> {
  assertLoopSupported(workflow);
  const maxIterations = effectiveMaxIterations(workflow, options);
  let iterationContext = initialIterationContext();
  let lastResult: WorkflowRunResult | undefined;
  const signalTrail: SignalTrailEntry[] = [];
  const stopHistory: StopHistoryEntry[] = [];

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    iterationContext = { ...iterationContext, iteration, stopHistory };
    lastResult = await executeWorkflowPass(workflow, options, {
      iterationContext,
      runId: lastResult?.runId,
    });
    const signal = requireSignal(workflow, lastResult.signalSnapshot);
    signalTrail.push({ iteration, signal });

    const stop = evaluateStopConditions(workflow, iterationContext, signal, maxIterations);
    stopHistory.push(toStopHistory(iteration, stop));
    if (stop.matched) {
      return finalizeLoop(workflow, options, lastResult, stop, signalTrail, stopHistory);
    }
    iterationContext = nextIterationContext(iterationContext, signal, lastResult);
  }

  throw new Error(`${workflow.name} loop exhausted without iteration-cap stop condition`);
}

function assertLoopSupported(workflow: WorkflowDefinition): void {
  const missing: string[] = [];
  if (!workflow.evaluateSignal) missing.push('evaluateSignal');
  if (!workflow.isTargetMet) missing.push('isTargetMet');
  if (missing.length > 0) {
    throw new Error(`${workflow.name} does not support --loop: missing ${missing.join(', ')}`);
  }
}

export function evaluateStopConditions(
  workflow: WorkflowDefinition,
  ctx: IterationContext,
  signal: EvaluationSignalSnapshot,
  maxIterations = workflow.iterationCap,
): StopDecision {
  for (const condition of workflow.stopConditions) {
    const decision = evaluateStopCondition(condition, workflow, ctx, signal, maxIterations);
    if (decision.matched) return decision;
  }
  const cap = iterationCapDecision(ctx, maxIterations);
  if (cap.matched) return cap;
  return { matched: false, condition: 'none', reason: 'no stop condition matched' };
}

function evaluateStopCondition(
  condition: StopPredicateName,
  workflow: WorkflowDefinition,
  ctx: IterationContext,
  signal: EvaluationSignalSnapshot,
  maxIterations: number,
): StopDecision {
  if (condition === 'target-met' || condition === 'findings-converged') {
    return targetMetDecision(condition, workflow, ctx, signal);
  }
  if (condition === 'same-blocker-repeated') return sameBlockerDecision(ctx, signal);
  if (condition === 'no-improvement') return noImprovementDecision(ctx, signal);
  if (condition === 'iteration-cap') return iterationCapDecision(ctx, maxIterations);
  return { matched: false, condition, reason: `unknown stop predicate: ${condition}` };
}

function targetMetDecision(
  condition: StopPredicateName,
  workflow: WorkflowDefinition,
  ctx: IterationContext,
  signal: EvaluationSignalSnapshot,
): StopDecision {
  const matched = Boolean(workflow.isTargetMet?.(signal, ctx));
  return {
    matched,
    condition,
    reason: matched ? `${condition} matched` : `${condition} not met`,
  };
}

function sameBlockerDecision(
  ctx: IterationContext,
  signal: EvaluationSignalSnapshot,
): StopDecision {
  const blocker = signal.blockerKey;
  const previous = ctx.previousSignal?.blockerKey;
  const matched = Boolean(blocker && previous && blocker === previous);
  return {
    matched,
    condition: 'same-blocker-repeated',
    reason: matched ? `same blocker repeated: ${blocker}` : 'blocker did not repeat',
  };
}

function noImprovementDecision(
  ctx: IterationContext,
  signal: EvaluationSignalSnapshot,
): StopDecision {
  if (!ctx.previousSignal) {
    return { matched: false, condition: 'no-improvement', reason: 'no previous signal' };
  }
  const current = signalScore(signal);
  const previous = signalScore(ctx.previousSignal);
  const matched = current >= previous;
  return {
    matched,
    condition: 'no-improvement',
    reason: matched ? `signal did not improve: ${previous} -> ${current}` : 'signal improved',
  };
}

function iterationCapDecision(ctx: IterationContext, maxIterations: number): StopDecision {
  const matched = ctx.iteration >= maxIterations;
  return {
    matched,
    condition: 'iteration-cap',
    reason: matched ? `iteration cap reached: ${ctx.iteration}/${maxIterations}` : 'under cap',
  };
}

function signalScore(signal: EvaluationSignalSnapshot): number {
  if (signal.kind === 'review-findings') {
    const weights = { critical: 100, high: 50, medium: 10, low: 3, info: 1 };
    return Object.entries(signal.severityCounts)
      .reduce((sum, [severity, count]) => sum + weights[severity as keyof typeof weights] * count, 0);
  }
  if (signal.kind === 'qa-checks') return signal.failedCount;
  return signal.score;
}

function effectiveMaxIterations(workflow: WorkflowDefinition, options: WorkflowRunOptions): number {
  const requested = options.maxIterations ?? workflow.iterationCap;
  if (!Number.isInteger(requested) || requested < 1) {
    throw new Error(`${workflow.name} --max-iterations must be a positive integer`);
  }
  if (requested > workflow.iterationCap) {
    throw new Error(`${workflow.name} --max-iterations cannot exceed registry cap ${workflow.iterationCap}`);
  }
  return requested;
}

function initialIterationContext(): IterationContext {
  return { iteration: 1, stopHistory: [] };
}

function requireSignal(
  workflow: WorkflowDefinition,
  signal: EvaluationSignalSnapshot | undefined,
): EvaluationSignalSnapshot {
  if (!signal) throw new Error(`${workflow.name} loop did not produce an evaluation signal`);
  return signal;
}

function toStopHistory(iteration: number, decision: StopDecision): StopHistoryEntry {
  return {
    iteration,
    condition: decision.condition,
    matched: decision.matched,
    reason: decision.reason,
  };
}

function nextIterationContext(
  ctx: IterationContext,
  signal: EvaluationSignalSnapshot,
  result: WorkflowRunResult,
): IterationContext {
  return {
    ...ctx,
    previousSignal: signal,
    previousFindings: result.iterationState.previousFindings ?? ctx.previousFindings,
    previousFailedChecks: result.iterationState.previousFailedChecks ?? ctx.previousFailedChecks,
  };
}

function finalizeLoop(
  workflow: WorkflowDefinition,
  options: WorkflowRunOptions,
  result: WorkflowRunResult,
  stop: StopDecision,
  signalTrail: SignalTrailEntry[],
  stopHistory: StopHistoryEntry[],
): WorkflowLoopResult {
  const event = buildEvidenceEvent({
    runId: result.runId,
    workflow: workflow.name,
    step: 'loop-summary',
    startedAt: new Date().toISOString(),
    durationMs: 0,
    status: 'ok',
    output: { stopReason: stop.condition, iterationCount: signalTrail.length, signalTrail },
    artifacts: result.artifacts,
    iterationCount: signalTrail.length,
    stopReason: stop.condition,
    signalTrail,
    stopHistory,
  });
  const evidencePath = writeEvidence(event, options);
  return { ...result, evidencePath, iterationCount: signalTrail.length, stopReason: stop.condition, signalTrail, stopHistory };
}
