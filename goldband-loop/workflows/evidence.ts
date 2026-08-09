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

export type TrackerTelemetryEvent = {
  schemaVersion: 1;
  provider: 'github' | 'gitlab';
  operation: 'preview' | 'publish' | 'inspect' | 'import';
  artifactCount: number;
  completedCount: number;
  pendingCount: number;
  status: 'completed' | 'pending' | 'blocked';
  durationMs: number;
  conflictReason?: string;
  recordedAt: string;
};

export function writeTrackerTelemetry(
  input: Omit<TrackerTelemetryEvent, 'schemaVersion' | 'recordedAt'>,
  options: WorkflowRunOptions = {},
): string {
  if (!Number.isSafeInteger(input.artifactCount) || input.artifactCount < 0 ||
      !Number.isSafeInteger(input.completedCount) || input.completedCount < 0 ||
      !Number.isSafeInteger(input.pendingCount) || input.pendingCount < 0 ||
      !Number.isFinite(input.durationMs) || input.durationMs < 0) {
    throw new Error('invalid tracker telemetry count or duration');
  }
  const conflictReason = input.conflictReason?.replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').slice(0, 160);
  const event: TrackerTelemetryEvent = {
    schemaVersion: 1,
    provider: input.provider,
    operation: input.operation,
    artifactCount: input.artifactCount,
    completedCount: input.completedCount,
    pendingCount: input.pendingCount,
    status: input.status,
    durationMs: Math.round(input.durationMs),
    ...(conflictReason ? { conflictReason } : {}),
    recordedAt: new Date().toISOString(),
  };
  const file = join(stateRoot(options), 'workflow-runs', 'tracker-sync.jsonl');
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(event)}\n`);
  return file;
}
