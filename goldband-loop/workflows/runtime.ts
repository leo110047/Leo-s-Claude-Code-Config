import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { assertRunnableWorkflow } from './definition';
import { buildEvidenceEvent, writeEvidence } from './evidence';
import { prepareSafetyGate, type SafetyGateAdmission, verifySafetyGate } from './safety-gates';
import type {
  EvaluationSignalSnapshot,
  IterationContext,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowRunOptions,
  WorkflowStep,
} from './types';

export type WorkflowRunResult = {
  runId: string;
  workflow: string;
  output: unknown;
  evidencePath: string;
  artifacts: string[];
  signalSnapshot?: EvaluationSignalSnapshot;
  iterationState: Partial<Pick<IterationContext, 'previousFindings' | 'previousFailedChecks'>>;
};

type WorkflowPass = {
  runId: string;
  workflow: WorkflowDefinition;
  startedAtMonotonicMs: number;
  options: WorkflowRunOptions;
  artifacts: string[];
  iterationContext?: IterationContext;
};

type WorkflowPassState = {
  input: unknown;
  signalSnapshot?: EvaluationSignalSnapshot;
  iterationState: WorkflowRunResult['iterationState'];
};

type StepRunResult = {
  output: unknown;
  evidencePath: string;
};

export async function runWorkflow(
  workflow: WorkflowDefinition,
  options: WorkflowRunOptions = {},
): Promise<WorkflowRunResult> {
  return executeWorkflowPass(workflow, options);
}

export async function executeWorkflowPass(
  workflow: WorkflowDefinition,
  options: WorkflowRunOptions = {},
  pass: { runId?: string; iterationContext?: IterationContext } = {},
): Promise<WorkflowRunResult> {
  assertRunnableWorkflow(workflow);
  assertHostContract(workflow, options);
  assertIteration(workflow, options);
  const workflowPass = await createWorkflowPass(workflow, options, pass);
  const state = await initialPassState(options);
  const initialInput = state.input;
  const safetyGate = prepareSafetyGateEvidence(workflowPass, initialInput);

  for (const step of workflow.steps) {
    const result = await runWorkflowStep(step, workflowPass, state);
    state.input = result.output;
    if (shouldStop(workflow, options)) {
      const safetyEvidencePath = writeSafetyGateVerification(
        workflowPass,
        safetyGate,
        initialInput,
        state.input,
      );
      return buildRunResult(
        workflowPass,
        state,
        safetyEvidencePath ?? result.evidencePath,
      );
    }
  }

  writeSafetyGateVerification(workflowPass, safetyGate, initialInput, state.input);
  return completeWorkflowPass(workflowPass, state);
}

function prepareSafetyGateEvidence(pass: WorkflowPass, input: unknown): SafetyGateAdmission | null {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  try {
    return prepareSafetyGate(pass.workflow, input);
  } catch (error) {
    writeEvidence(
      buildEvidenceEvent({
        runId: pass.runId,
        workflow: pass.workflow.name,
        step: 'safety-gate:blocked',
        startedAt,
        durationMs: Math.round(performance.now() - started),
        status: 'failed',
        output: null,
        artifacts: pass.artifacts,
        iteration: pass.iterationContext?.iteration,
        error: error instanceof Error ? error.message : String(error),
      }),
      pass.options,
    );
    throw error;
  }
}

function writeSafetyGateVerification(
  pass: WorkflowPass,
  admission: SafetyGateAdmission | null,
  input: unknown,
  output: unknown,
): string | null {
  if (!admission) return null;
  const startedAt = new Date().toISOString();
  const started = performance.now();
  try {
    const verification = verifySafetyGate(admission, input, output, pass.options);
    return writeEvidence(
      buildEvidenceEvent({
        runId: pass.runId,
        workflow: pass.workflow.name,
        step: `safety-gate:${admission.operation}:${verification.state}`,
        startedAt,
        durationMs: Math.round(performance.now() - started),
        status: verification.state === 'verified' ? 'ok' : 'skipped',
        output: verification,
        artifacts: pass.artifacts,
        iteration: pass.iterationContext?.iteration,
      }),
      pass.options,
    );
  } catch (error) {
    writeEvidence(
      buildEvidenceEvent({
        runId: pass.runId,
        workflow: pass.workflow.name,
        step: `safety-gate:${admission.operation}:failed`,
        startedAt,
        durationMs: Math.round(performance.now() - started),
        status: 'failed',
        output: null,
        artifacts: pass.artifacts,
        iteration: pass.iterationContext?.iteration,
        error: error instanceof Error ? error.message : String(error),
      }),
      pass.options,
    );
    throw error;
  }
}

function assertHostContract(workflow: WorkflowDefinition, options: WorkflowRunOptions): void {
  const mode = options.mode ?? 'mock';
  const host = options.host ?? 'mock';
  if (mode === 'real' && host === 'mock') {
    throw new Error(`${workflow.name}: real mode requires an explicit host`);
  }
  if (host !== 'mock' && mode !== 'real') {
    throw new Error(`${workflow.name}: host ${host} requires real mode`);
  }
  if (host !== 'mock' && !workflow.hostSupport.includes(host)) {
    throw new Error(`${workflow.name}: host ${host} is not supported`);
  }
}

async function createWorkflowPass(
  workflow: WorkflowDefinition,
  options: WorkflowRunOptions,
  pass: { runId?: string; iterationContext?: IterationContext },
): Promise<WorkflowPass> {
  return {
    runId: pass.runId ?? randomUUID(),
    workflow,
    startedAtMonotonicMs: performance.now(),
    options,
    artifacts: [],
    iterationContext: pass.iterationContext,
  };
}

async function initialPassState(options: WorkflowRunOptions): Promise<WorkflowPassState> {
  return {
    input: await readInput(options),
    iterationState: {},
  };
}

async function runWorkflowStep(
  step: WorkflowStep,
  pass: WorkflowPass,
  state: WorkflowPassState,
): Promise<StepRunResult> {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  try {
    return await runSuccessfulStep(step, pass, state, startedAt, started);
  } catch (error) {
    writeFailedStep(step, pass, state, startedAt, started, error);
    throw error;
  }
}

async function runSuccessfulStep(
  step: WorkflowStep,
  pass: WorkflowPass,
  state: WorkflowPassState,
  startedAt: string,
  started: number,
): Promise<StepRunResult> {
  const raw = await step.run(stepContext(pass, state.input));
  const output = step.produces.validate(raw);
  captureStepState(step, pass, state, output);
  const evidencePath = writeEvidence(
    buildEvidenceEvent({
      runId: pass.runId,
      workflow: pass.workflow.name,
      step: step.name,
      startedAt,
      durationMs: Math.round(performance.now() - started),
      status: 'ok',
      output,
      artifacts: pass.artifacts,
      iteration: pass.iterationContext?.iteration,
      signalSnapshot: state.signalSnapshot,
    }),
    pass.options,
  );
  return { output, evidencePath };
}

function captureStepState(
  step: WorkflowStep,
  pass: WorkflowPass,
  state: WorkflowPassState,
  output: unknown,
): void {
  const ctx = stepContext(pass, state.input);
  state.signalSnapshot =
    pass.workflow.evaluateSignal?.(output, ctx, step.name) ?? state.signalSnapshot;
  Object.assign(
    state.iterationState,
    pass.workflow.captureIterationState?.(output, ctx, step.name),
  );
}

function writeFailedStep(
  step: WorkflowStep,
  pass: WorkflowPass,
  state: WorkflowPassState,
  startedAt: string,
  started: number,
  error: unknown,
): void {
  writeEvidence(
    buildEvidenceEvent({
      runId: pass.runId,
      workflow: pass.workflow.name,
      step: step.name,
      startedAt,
      durationMs: Math.round(performance.now() - started),
      status: 'failed',
      output: null,
      artifacts: pass.artifacts,
      iteration: pass.iterationContext?.iteration,
      signalSnapshot: state.signalSnapshot,
      error: error instanceof Error ? error.message : String(error),
    }),
    pass.options,
  );
}

function completeWorkflowPass(pass: WorkflowPass, state: WorkflowPassState): WorkflowRunResult {
  const evidencePath = writeEvidence(
    buildEvidenceEvent({
      runId: pass.runId,
      workflow: pass.workflow.name,
      step: 'workflow-complete',
      startedAt: new Date().toISOString(),
      durationMs: 0,
      status: 'ok',
      output: state.input,
      artifacts: pass.artifacts,
      iteration: pass.iterationContext?.iteration,
      signalSnapshot: state.signalSnapshot,
    }),
    pass.options,
  );
  return buildRunResult(pass, state, evidencePath);
}

function buildRunResult(
  pass: WorkflowPass,
  state: WorkflowPassState,
  evidencePath: string,
): WorkflowRunResult {
  return {
    runId: pass.runId,
    workflow: pass.workflow.name,
    output: state.input,
    evidencePath,
    artifacts: pass.artifacts,
    signalSnapshot: state.signalSnapshot,
    iterationState: state.iterationState,
  };
}

function stepContext(pass: WorkflowPass, input: unknown): WorkflowContext {
  return {
    runId: pass.runId,
    workflow: pass.workflow,
    cwd: pass.options.cwd || process.cwd(),
    passStartedAtMonotonicMs: pass.startedAtMonotonicMs,
    input,
    options: pass.options,
    artifacts: pass.artifacts,
    iterationContext: pass.iterationContext,
  };
}

function assertIteration(workflow: WorkflowDefinition, options: WorkflowRunOptions): void {
  const iteration = options.iteration ?? 1;
  if (iteration > workflow.iterationCap) {
    throw new Error(
      `${workflow.name} iteration cap exceeded: ${iteration}/${workflow.iterationCap}`,
    );
  }
}

function shouldStop(workflow: WorkflowDefinition, options: WorkflowRunOptions): boolean {
  return Boolean(
    options.repeatedBlocker && workflow.stopConditions.includes('same-blocker-repeated'),
  );
}

async function readInput(options: WorkflowRunOptions): Promise<unknown> {
  if (!options.inputFile) return undefined;
  const { readFileSync } = await import('node:fs');
  return JSON.parse(readFileSync(options.inputFile, 'utf8'));
}
