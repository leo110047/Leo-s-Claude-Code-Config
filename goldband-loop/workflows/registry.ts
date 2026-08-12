import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CAPABILITY_ACTIONS } from './capability-registry.generated';
import { defineWorkflow } from './definition';
import { ownedRuntimeSteps } from './owned-runtime';
import { workflowAssetPath } from './paths';
import { captureQaIterationState, qaSignalFromOutput, qaSteps, qaTargetMet } from './qa';
import { reviewSignalFromOutput, reviewSteps } from './review';
import { objectSchema } from './schema';
import type { WorkflowDefinition, WorkflowStep } from './types';

export const CORE_WORKFLOWS = CAPABILITY_ACTIONS.filter(
  (entry) => entry.lifecycle === 'public' && entry.runtime !== 'registered-only',
).map((entry) => entry.name);

export const WORKFLOW_REGISTRY: WorkflowDefinition[] = CAPABILITY_ACTIONS.map((entry) =>
  defineWorkflow({
    capability: entry.capability,
    action: entry.action,
    name: entry.name,
    target: targetFor(entry.name),
    evaluationSignal: evaluationFor(entry.name),
    iterationCap: iterationCapFor(entry.name),
    stopConditions: stopConditionsFor(entry.name),
    contractPath: entry.contractPath,
    entrypointType:
      entry.runtime === 'typed'
        ? 'typed'
        : entry.runtime === 'compatibility'
          ? 'compatibility'
          : 'legacy-thin',
    integrationStatus: entry.runtime === 'registered-only' ? 'registered-only' : 'integrated',
    lifecycle: entry.lifecycle,
    runtimeOwner: entry.runtimeOwner,
    runtimeContract: entry.runtimeContract,
    safetyGates: entry.safetyGates,
    hostSupport: entry.hostSupport,
    riskLevel: entry.riskLevel,
    evidencePolicy:
      'Write one JSONL event per runtime step with digest, status, duration, and artifacts.',
    migrationNotes: migrationFor(entry.name, entry.runtime),
    nextStep: nextStepFor(entry.name),
    steps: stepsFor(entry.name, entry.runtime),
    ...loopHooksFor(entry.name),
  }),
);

export function getWorkflow(name: string): WorkflowDefinition {
  const workflow = WORKFLOW_REGISTRY.find((entry) => entry.name === name);
  if (!workflow) throw new Error(`unknown workflow: ${name}`);
  return workflow;
}

export function integratedWorkflows(): WorkflowDefinition[] {
  return WORKFLOW_REGISTRY.filter((entry) => entry.integrationStatus === 'integrated');
}

export function registeredOnlyWorkflows(): WorkflowDefinition[] {
  return WORKFLOW_REGISTRY.filter((entry) => entry.integrationStatus === 'registered-only');
}

export function publicWorkflows(): WorkflowDefinition[] {
  return WORKFLOW_REGISTRY.filter((entry) => entry.lifecycle === 'public');
}

export function experimentalWorkflows(): WorkflowDefinition[] {
  return WORKFLOW_REGISTRY.filter((entry) => entry.lifecycle === 'experimental');
}

function stepsFor(name: string, runtime: string): WorkflowStep[] {
  if (name === 'review/code') return reviewSteps;
  if (name === 'qa/app') return qaSteps;
  const owned = ownedRuntimeSteps(name);
  if (owned) return owned;
  if (runtime === 'compatibility') return compatibilitySteps(name);
  return [];
}

function compatibilitySteps(name: string): WorkflowStep[] {
  return [
    {
      name: 'legacy-prompt-dispatch',
      kind: 'legacyPrompt',
      produces: objectSchema,
      run(ctx) {
        if (ctx.options.mode === 'real') {
          throw new Error(
            `${name} compatibility runtime only supports mock mode until typed migration is complete`,
          );
        }
        const contractPath = getWorkflow(name).contractPath;
        const content = readFileSync(workflowAssetPath(contractPath), 'utf8');
        return {
          mode: 'compatibility',
          workflow: name,
          contractPath,
          contractDigest: promptDigest(content),
        };
      },
    },
  ];
}

function promptDigest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function targetFor(name: string): string {
  if (name === 'review/code') return 'Find concrete pre-landing code risks from a diff.';
  if (name === 'plan/create') return 'Create a validated, versioned Work Map for cross-session work.';
  if (name.includes('investigate')) return 'Find root cause with explicit evidence.';
  if (name.includes('qa')) return 'Verify user-visible behavior with pass/fail evidence.';
  if (name.includes('plan')) return 'Improve or validate implementation plans before code changes.';
  if (name.includes('ship') || name.includes('deploy'))
    return 'Prepare release work with explicit safety gates.';
  return `Run the ${name} workflow with bounded evidence capture.`;
}

function evaluationFor(name: string): string {
  if (name === 'review/code')
    return 'Validated findings and rendered report from the selected diff.';
  if (name === 'plan/create')
    return 'Persisted Work Map readback matches its calculated frontier, revision, and digest.';
  if (name.includes('qa'))
    return 'Recorded pass/fail checks, screenshots, or reproduction evidence.';
  if (name.includes('investigate'))
    return 'Hypothesis narrowed to a verified cause or explicit blocker.';
  if (name.includes('ship') || name.includes('deploy'))
    return 'Release gates and post-action readback are explicit.';
  return 'Workflow run emits step evidence and reaches its declared stop condition.';
}

function stopConditionsFor(name: string): string[] {
  if (name === 'review/code') return ['iteration-cap'];
  if (name === 'qa/app') {
    return ['target-met', 'same-blocker-repeated', 'no-improvement', 'iteration-cap'];
  }
  return ['target-met', 'same-blocker-repeated', 'iteration-cap'];
}

function iterationCapFor(name: string): number {
  if (name === 'qa/app') return 2;
  return 1;
}

function migrationFor(name: string, runtime: string): string {
  if (name === 'review/code') return 'First fully typed capability action.';
  if (name === 'qa/app') return 'Minimal typed mock adapter for convergence-loop runtime.';
  if (ownedRuntimeSteps(name))
    return 'Typed runtime delegated to an explicit state, evidence, or tool owner.';
  if (runtime === 'compatibility') return 'Compatibility runtime; typed migration still pending.';
  return 'Experimental inventory only; runtime owner and integration pending.';
}

function nextStepFor(name: string): string {
  if (name === 'review/code') return 'Keep schema and evidence fixtures stable.';
  if (name === 'plan/create')
    return 'Execute or shape one ticket from the runtime-calculated frontier.';
  if (name === 'qa/app')
    return 'Promote real browser checks and screenshot artifacts after mock loop settles.';
  if (name.includes('investigate')) return 'Promote hypothesis and evidence loop to typed steps.';
  if (name.includes('qa')) return 'Promote browser checks and screenshot artifacts to typed steps.';
  if (name.includes('plan'))
    return 'Type non-interactive review pieces while preserving HITL prompts.';
  if (name.includes('cso')) return 'Add typed security checklist and evidence gates.';
  if (name.includes('ship') || name.includes('deploy'))
    return 'Add safety-gate typed steps before side effects.';
  return 'Prioritize after core runtime coverage settles.';
}

function loopHooksFor(name: string): Partial<WorkflowDefinition> {
  if (name === 'review/code') {
    return {
      evaluateSignal: reviewSignalFromOutput,
    };
  }
  if (name === 'qa/app') {
    return {
      evaluateSignal: qaSignalFromOutput,
      isTargetMet: qaTargetMet,
      captureIterationState: captureQaIterationState,
    };
  }
  return {};
}
