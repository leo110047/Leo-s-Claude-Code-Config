import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { assertRunnableWorkflow } from './definition';
import { buildEvidenceEvent, writeEvidence } from './evidence';
import type { WorkflowDefinition, WorkflowRunOptions } from './types';

export type WorkflowRunResult = {
  runId: string;
  workflow: string;
  output: unknown;
  evidencePath: string;
  artifacts: string[];
};

export async function runWorkflow(
  workflow: WorkflowDefinition,
  options: WorkflowRunOptions = {},
): Promise<WorkflowRunResult> {
  assertRunnableWorkflow(workflow);
  assertIteration(workflow, options);
  const runId = randomUUID();
  let input = await readInput(options);
  const artifacts: string[] = [];

  for (const step of workflow.steps) {
    const startedAt = new Date().toISOString();
    const started = performance.now();
    try {
      const raw = await step.run({
        runId,
        workflow,
        cwd: options.cwd || process.cwd(),
        input,
        options,
        artifacts,
      });
      const output = step.produces.validate(raw);
      const event = buildEvidenceEvent({
        runId,
        workflow: workflow.name,
        step: step.name,
        startedAt,
        durationMs: Math.round(performance.now() - started),
        status: 'ok',
        output,
        artifacts,
      });
      const evidenceFile = writeEvidence(event, options);
      input = output;
      if (shouldStop(workflow, options)) {
        return { runId, workflow: workflow.name, output, evidencePath: evidenceFile, artifacts };
      }
    } catch (error) {
      const event = buildEvidenceEvent({
        runId,
        workflow: workflow.name,
        step: step.name,
        startedAt,
        durationMs: Math.round(performance.now() - started),
        status: 'failed',
        output: null,
        artifacts,
        error: error instanceof Error ? error.message : String(error),
      });
      writeEvidence(event, options);
      throw error;
    }
  }

  return {
    runId,
    workflow: workflow.name,
    output: input,
    evidencePath: writeEvidence(buildEvidenceEvent({
      runId,
      workflow: workflow.name,
      step: 'workflow-complete',
      startedAt: new Date().toISOString(),
      durationMs: 0,
      status: 'ok',
      output: input,
      artifacts,
    }), options),
    artifacts,
  };
}

function assertIteration(workflow: WorkflowDefinition, options: WorkflowRunOptions): void {
  const iteration = options.iteration ?? 1;
  if (iteration > workflow.iterationCap) {
    throw new Error(`${workflow.name} iteration cap exceeded: ${iteration}/${workflow.iterationCap}`);
  }
}

function shouldStop(workflow: WorkflowDefinition, options: WorkflowRunOptions): boolean {
  return Boolean(options.repeatedBlocker && workflow.stopConditions.includes('same-blocker-repeated'));
}

async function readInput(options: WorkflowRunOptions): Promise<unknown> {
  if (!options.inputFile) return undefined;
  const { readFileSync } = await import('node:fs');
  return JSON.parse(readFileSync(options.inputFile, 'utf8'));
}
