import type { WorkflowDefinition, WorkflowStep } from './types';

type WorkflowInput = Omit<WorkflowDefinition, 'steps'> & {
  steps?: WorkflowStep[];
};

export function defineWorkflow(input: WorkflowInput): WorkflowDefinition {
  assertText(input.name, 'name');
  assertText(input.target, 'target');
  assertText(input.evaluationSignal, 'evaluationSignal');
  assertText(input.sourceTemplate, 'sourceTemplate');
  if (!Number.isInteger(input.iterationCap) || input.iterationCap < 1) {
    throw new Error(`${input.name}: iterationCap must be a positive integer`);
  }
  if (!Array.isArray(input.stopConditions) || input.stopConditions.length === 0) {
    throw new Error(`${input.name}: stopConditions must be non-empty`);
  }
  if (!Array.isArray(input.hostSupport) || input.hostSupport.length === 0) {
    throw new Error(`${input.name}: hostSupport must be non-empty`);
  }
  return { ...input, steps: input.steps ?? [] };
}

export function assertRunnableWorkflow(workflow: WorkflowDefinition): void {
  if (workflow.integrationStatus !== 'integrated') {
    throw new Error(`${workflow.name} is registered-only and is not runnable yet`);
  }
  if (workflow.steps.length === 0) {
    throw new Error(`${workflow.name} has no runtime steps`);
  }
}

function assertText(value: unknown, field: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`workflow ${field} must be a non-empty string`);
  }
}
