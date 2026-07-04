import { createHash } from 'node:crypto';
import { mkdirSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { StepEvidenceEvent, StepStatus, WorkflowRunOptions } from './types';

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
  if (options.goldbandHome) return options.goldbandHome;
  if (process.env.GOLDBAND_HOME) return process.env.GOLDBAND_HOME;
  if (process.env.GOLDBAND_STATE_DIR) return process.env.GOLDBAND_STATE_DIR;
  if (process.env.GOLDBAND_STATE_ROOT) return process.env.GOLDBAND_STATE_ROOT;
  if (pluginDataBelongsToGoldband()) return process.env.CLAUDE_PLUGIN_DATA as string;
  return join(homedir(), '.goldband');
}

function pluginDataBelongsToGoldband(): boolean {
  return Boolean(
    process.env.CLAUDE_PLUGIN_DATA &&
    process.env.CLAUDE_PLUGIN_ROOT?.toLowerCase().includes('goldband'),
  );
}
