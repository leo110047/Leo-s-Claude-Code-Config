import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineWorkflow } from './definition';
import { workflowAssetPath } from './paths';
import { objectSchema } from './schema';
import type { HostName, RiskLevel, WorkflowDefinition, WorkflowStep } from './types';
import { reviewSteps } from './review';

const ALL_HOSTS: HostName[] = [
  'claude',
  'codex',
  'factory',
  'kiro',
  'opencode',
  'slate',
  'cursor',
  'openclaw',
  'hermes',
  'gbrain',
];

export const CORE_WORKFLOWS = [
  'goldband-review',
  'goldband-investigate',
  'goldband-qa',
  'plan',
  'goldband-cso',
  'goldband-ship',
] as const;

const WORKFLOW_NAMES = [
  'goldband-autoplan',
  'goldband-benchmark',
  'goldband-benchmark-models',
  'goldband-browse',
  'goldband-canary',
  'goldband-careful',
  'goldband-codex',
  'goldband-context-restore',
  'goldband-context-save',
  'goldband-cso',
  'goldband-design-consultation',
  'goldband-design-html',
  'goldband-design-review',
  'goldband-design-shotgun',
  'goldband-devex-review',
  'goldband-document-generate',
  'goldband-document-release',
  'goldband-freeze',
  'goldband-guard',
  'goldband-health',
  'goldband-investigate',
  'goldband-ios-clean',
  'goldband-ios-design-review',
  'goldband-ios-fix',
  'goldband-ios-qa',
  'goldband-ios-sync',
  'goldband-land-and-deploy',
  'goldband-landing-report',
  'goldband-learn',
  'goldband-make-pdf',
  'goldband-office-hours',
  'goldband-open-goldband-browser',
  'goldband-pair-agent',
  'goldband-plan-ceo-review',
  'goldband-plan-design-review',
  'goldband-plan-devex-review',
  'goldband-plan-eng-review',
  'goldband-plan-tune',
  'goldband-qa',
  'goldband-qa-only',
  'goldband-retro',
  'goldband-review',
  'goldband-scrape',
  'goldband-setup-browser-cookies',
  'goldband-setup-deploy',
  'goldband-setup-gbrain',
  'goldband-ship',
  'goldband-skillify',
  'goldband-sync-gbrain',
  'goldband-unfreeze',
  'goldband-upgrade',
  'plan',
] as const;

export type WorkflowName = (typeof WORKFLOW_NAMES)[number];

export const WORKFLOW_REGISTRY: WorkflowDefinition[] = WORKFLOW_NAMES.map((name) =>
  defineWorkflow({
    name,
    target: targetFor(name),
    evaluationSignal: evaluationFor(name),
    iterationCap: name === 'goldband-review' ? 2 : 1,
    stopConditions: stopConditionsFor(name),
    sourceTemplate: sourceTemplateFor(name),
    entrypointType: entrypointTypeFor(name),
    integrationStatus: isCore(name) ? 'integrated' : 'registered-only',
    hostSupport: name === 'plan' ? ['claude'] : ALL_HOSTS,
    riskLevel: riskFor(name),
    evidencePolicy: 'Write one JSONL event per runtime step with digest, status, duration, and artifacts.',
    migrationNotes: migrationFor(name),
    nextStep: nextStepFor(name),
    steps: stepsFor(name),
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

function isCore(name: string): boolean {
  return (CORE_WORKFLOWS as readonly string[]).includes(name);
}

function stepsFor(name: string): WorkflowStep[] {
  if (name === 'goldband-review') return reviewSteps;
  if (isCore(name)) return compatibilitySteps(name);
  return [];
}

function compatibilitySteps(name: string): WorkflowStep[] {
  return [{
    name: 'legacy-prompt-dispatch',
    kind: 'legacyPrompt',
    produces: objectSchema,
    run(ctx) {
      if (ctx.options.mode === 'real') {
        throw new Error(`${name} compatibility runtime only supports mock mode; use the markdown skill until typed migration is complete`);
      }
      const sourceTemplate = sourceTemplateFor(name);
      const content = readFileSync(workflowAssetPath(sourceTemplate), 'utf8');
      return {
        mode: 'compatibility',
        workflow: name,
        sourceTemplate,
        legacyPromptDigest: promptDigest(content),
      };
    },
  }];
}

function entrypointTypeFor(name: string) {
  if (name === 'goldband-review') return 'typed' as const;
  if (isCore(name)) return 'compatibility' as const;
  return 'legacy-thin' as const;
}

function sourceTemplateFor(name: string): string {
  if (name === 'plan') return '../commands/plan.md';
  if (name === 'goldband-upgrade') return 'goldband-upgrade/SKILL.md.tmpl';
  return `${name.replace(/^goldband-/, '')}/SKILL.md.tmpl`;
}

function promptDigest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function targetFor(name: string): string {
  if (name === 'goldband-review') return 'Find concrete pre-landing code risks from a diff.';
  if (name.includes('investigate')) return 'Find root cause with explicit evidence.';
  if (name.includes('qa')) return 'Verify user-visible behavior with pass/fail evidence.';
  if (name.includes('plan')) return 'Improve or validate implementation plans before code changes.';
  if (name.includes('ship') || name.includes('deploy')) return 'Prepare release work with explicit safety gates.';
  return `Run the ${name} workflow with bounded evidence capture.`;
}

function evaluationFor(name: string): string {
  if (name === 'goldband-review') return 'Validated findings and rendered report from the selected diff.';
  if (name.includes('qa')) return 'Recorded pass/fail checks, screenshots, or reproduction evidence.';
  if (name.includes('investigate')) return 'Hypothesis narrowed to a verified cause or explicit blocker.';
  if (name.includes('ship') || name.includes('deploy')) return 'Release gates and post-action readback are explicit.';
  return 'Workflow run emits step evidence and reaches its declared stop condition.';
}

function stopConditionsFor(name: string): string[] {
  if (name === 'goldband-review') {
    return ['findings-converged', 'same-blocker-repeated', 'iteration-cap'];
  }
  return ['target-met', 'same-blocker-repeated', 'iteration-cap'];
}

function migrationFor(name: string): string {
  if (name === 'goldband-review') return 'First fully typed workflow.';
  if (isCore(name)) return 'Core compatibility runtime; typed migration still pending.';
  return 'Registered for inventory coverage; runtime integration pending.';
}

function nextStepFor(name: string): string {
  if (name === 'goldband-review') return 'Keep schema and evidence fixtures stable.';
  if (name.includes('investigate')) return 'Promote hypothesis and evidence loop to typed steps.';
  if (name.includes('qa')) return 'Promote browser checks and screenshot artifacts to typed steps.';
  if (name.includes('plan')) return 'Type non-interactive review pieces while preserving HITL prompts.';
  if (name.includes('cso')) return 'Add typed security checklist and evidence gates.';
  if (name.includes('ship') || name.includes('deploy')) return 'Add safety-gate typed steps before side effects.';
  return 'Prioritize after core runtime coverage settles.';
}

function riskFor(name: string): RiskLevel {
  if (/(ship|deploy|canary|upgrade|sync|setup|land-and-deploy|ios-qa)/.test(name)) return 'high';
  if (/(qa|browse|cso|review|investigate|scrape|pair-agent|make-pdf)/.test(name)) return 'medium';
  return 'low';
}
