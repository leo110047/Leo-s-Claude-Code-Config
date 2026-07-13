import { createHash } from 'node:crypto';
import { mkdirSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveGoldbandStateRoot } from '../lib/state-root';
import type {
  EvaluationSignalSnapshot,
  SignalTrailEntry,
  StepEvidenceEvent,
  StepStatus,
  StopHistoryEntry,
  WorkflowRunOptions,
} from './types';

export function evidencePath(workflow: string, options: WorkflowRunOptions = {}): string {
  return join(stateRoot(options), 'workflow-runs', `${workflow}.jsonl`);
}

export function writeEvidence(event: StepEvidenceEvent, options: WorkflowRunOptions = {}): string {
  const file = evidencePath(event.workflow, options);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(event)}\n`);
  return file;
}

export function buildEvidenceEvent(input: {
  runId: string;
  workflow: string;
  step: string;
  startedAt: string;
  durationMs: number;
  status: StepStatus;
  output: unknown;
  artifacts?: string[];
  iteration?: number;
  signalSnapshot?: EvaluationSignalSnapshot;
  iterationCount?: number;
  stopReason?: string;
  signalTrail?: SignalTrailEntry[];
  stopHistory?: StopHistoryEntry[];
  error?: string;
}): StepEvidenceEvent {
  return {
    runId: input.runId,
    workflow: input.workflow,
    step: input.step,
    startedAt: input.startedAt,
    durationMs: input.durationMs,
    status: input.status,
    outputDigest: digest(input.output),
    artifacts: input.artifacts ?? [],
    ...(input.iteration ? { iteration: input.iteration } : {}),
    ...(input.signalSnapshot ? { signalSnapshot: input.signalSnapshot } : {}),
    ...(input.iterationCount ? { iterationCount: input.iterationCount } : {}),
    ...(input.stopReason ? { stopReason: input.stopReason } : {}),
    ...(input.signalTrail ? { signalTrail: input.signalTrail } : {}),
    ...(input.stopHistory ? { stopHistory: input.stopHistory } : {}),
    ...(input.error ? { error: input.error } : {}),
  };
}

export function digest(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(value) ?? 'null')
    .digest('hex')
    .slice(0, 16);
}

export function stateRoot(options: WorkflowRunOptions = {}): string {
  return resolveGoldbandStateRoot(options.goldbandHome);
}
