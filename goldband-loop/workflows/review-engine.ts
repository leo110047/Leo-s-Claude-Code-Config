import { readFileSync } from 'node:fs';
import { REVIEW_NON_INTERACTIVE_COMMAND_POLICY } from '../lib/review-runtime-contract';
import type { HostAdapter, HostRunOptions } from './host-adapter';
import { workflowAssetPath } from './paths';
import {
  formatReviewImpactContext,
  type ReviewImpactContext,
  WIDE_IMPACT_FILE_THRESHOLD,
} from './review-impact';
import {
  type RulesBundle,
  type RulesSnapshot,
  specialistReviewRules,
} from './review-rules';
import { DEFAULT_REVIEW_HOST_TIMEOUT_MS } from './review-timeouts';
import type { ReviewFinding, WorkflowContext } from './types';

const REVIEW_SEVERITIES: ReviewFinding['severity'][] = [
  'critical',
  'high',
  'medium',
  'low',
  'info',
];

export const REVIEW_SPECIALISTS = [
  'correctness-contract',
  'testing',
  'security',
  'performance',
  'migration-data',
  'api-host-parity',
  'maintainability',
] as const;

export type ReviewSpecialist = (typeof REVIEW_SPECIALISTS)[number];

export type SpecialistSelection = {
  selected: ReviewSpecialist[];
  skipped: Array<{ specialist: ReviewSpecialist; reason: string }>;
};

export type SpecialistMode = 'off' | 'auto' | 'all';

export type PreparedSpecialistReview = {
  selection: SpecialistSelection;
  items: Array<{
    specialist: ReviewSpecialist;
    prompt: string;
    bundle: RulesBundle;
  }>;
};

const SPECIALIST_CONCURRENCY = 2;

const SPECIALIST_GUIDANCE: Record<ReviewSpecialist, string> = {
  'correctness-contract':
    'Check functional correctness, state transitions, contract fields, error handling, and data consistency.',
  testing:
    'Check whether tests would fail on the old behavior, cover the real risk, and include useful fixtures.',
  security:
    'Check auth/authz, secrets, injection, unsafe IO, supply chain, sandboxing, and trust boundaries.',
  performance:
    'Check N+1 patterns, hot paths, query or bundle growth, memory pressure, and clear scaling risks.',
  'migration-data':
    'Check migrations, schemas, backfills, backwards compatibility, rollback, and rollout safety.',
  'api-host-parity':
    'Check CLI/API contracts, Claude/Codex host parity, installer output, workflow routing, and prompt/runtime consistency.',
  maintainability:
    'Check duplicated logic, abstraction fit, module boundaries, naming, and long-term maintenance risk.',
};

export function selectReviewSpecialists(
  diff: string,
  mode: SpecialistMode = 'auto',
  impact?: ReviewImpactContext,
): SpecialistSelection {
  if (mode === 'off') {
    return {
      selected: [],
      skipped: REVIEW_SPECIALISTS.map((specialist) => ({
        specialist,
        reason: 'specialists disabled by --specialists off',
      })),
    };
  }

  if (mode === 'all') {
    return { selected: [...REVIEW_SPECIALISTS], skipped: [] };
  }

  const lower = diff.toLowerCase();
  const selected: ReviewSpecialist[] = [];

  if (/\b(auth|authorization|permission|secret|token|csrf|xss|sql injection|sandbox|trust boundary)\b/.test(lower)) {
    selected.push('security');
  }
  if (/\b(migration|prisma|knex|sequelize|database schema|database|sql|backfill|rollback|alter table)\b/.test(lower)) {
    selected.push('migration-data');
  }
  if (/\b(workflow|host-adapter|codex|claude|installer|prompt|skill|hook|sandbox|allowed-tools|cross-review)\b/.test(lower)) {
    selected.push('api-host-parity');
  }
  if (/\b(performance|n\+1|bundle|cache stampede|memory pressure|latency regression|hot path)\b/.test(lower)) {
    selected.push('performance');
  }
  if (impact && impact.status !== 'skipped' && impact.filesWithoutObservedTests.length > 0) {
    selected.push('testing');
  }
  if (
    impact &&
    impact.status !== 'skipped' &&
    (impact.truncated || impact.impactedFiles.length >= WIDE_IMPACT_FILE_THRESHOLD)
  ) {
    selected.push('maintainability');
  }

  const selectedSet = new Set(selected);

  return {
    selected: REVIEW_SPECIALISTS.filter((specialist) => selectedSet.has(specialist)),
    skipped: REVIEW_SPECIALISTS
      .filter((specialist) => !selectedSet.has(specialist))
      .map((specialist) => ({
        specialist,
        reason: 'diff scope not relevant',
      })),
  };
}

export async function runParallelSpecialistReview(
  ctx: WorkflowContext,
  adapter: HostAdapter,
  diff: string,
  schema: unknown,
  mode: SpecialistMode = 'auto',
  prepared?: PreparedSpecialistReview,
  hostRunOptions: () => HostRunOptions = () => ({
    timeoutMs: DEFAULT_REVIEW_HOST_TIMEOUT_MS,
  }),
): Promise<ReviewFinding[]> {
  const selection = prepared?.selection ?? selectReviewSpecialists(diff, mode);
  if (mode === 'off') {
    return [];
  }
  if (selection.selected.length === 0) return [];

  if (!adapter.capabilities.readOnlyEnforced) {
    const failures = [
      capabilityFinding(adapter.name, 'read-only enforcement unavailable'),
    ];
    assertSpecialistCoverageComplete(mode, failures);
    return failures;
  }

  if (!adapter.capabilities.parallelDispatch) {
    const failures = [
      capabilityFinding(adapter.name, 'parallel specialist dispatch unavailable'),
    ];
    assertSpecialistCoverageComplete(mode, failures);
    return failures;
  }

  const items = prepared?.items ?? prepareSpecialistReview(ctx, diff, mode).items;
  const jobs = items.map(({ specialist, prompt }) => async () => {
    const result = await adapter.runJson(
      prompt,
      schema,
      ctx.cwd,
      hostRunOptions(),
    );
    return normalizeSpecialistFindings(unwrapFindings(result.parsed), specialist);
  });

  const settled = await runBounded(jobs, SPECIALIST_CONCURRENCY);
  const findings: ReviewFinding[] = [];
  const failures: ReviewFinding[] = [];
  for (let index = 0; index < settled.length; index += 1) {
    const result = settled[index];
    if (result.status === 'fulfilled') findings.push(...result.value);
    else {
      const failure = specialistFailureFinding(selection.selected[index], result.reason);
      findings.push(failure);
      failures.push(failure);
    }
  }
  assertSpecialistCoverageComplete(mode, failures);
  return aggregateReviewFindings(findings);
}

export function prepareSpecialistReview(
  ctx: WorkflowContext,
  diff: string,
  mode: SpecialistMode = 'auto',
  snapshot?: RulesSnapshot,
  impact?: ReviewImpactContext,
): PreparedSpecialistReview {
  const selection = selectReviewSpecialists(diff, mode, impact);
  const items = selection.selected.map((specialist) => {
    const rules = specialistReviewRules(ctx.cwd, specialist, snapshot);
    return {
      specialist,
      prompt: buildSpecialistPrompt(ctx, diff, specialist, rules, impact),
      bundle: rules.bundle,
    };
  });
  return { selection, items };
}

export function aggregateReviewFindings(findings: ReviewFinding[]): ReviewFinding[] {
  const byKey = new Map<string, ReviewFinding>();
  for (const finding of findings.map(normalizeReviewFinding)) {
    const key = stableFindingKey(finding);
    const existing = byKey.get(key);
    byKey.set(key, existing ? mergeFindings(existing, finding) : finding);
  }
  return [...byKey.values()].sort(compareFindings);
}

function normalizeReviewFinding(finding: ReviewFinding): ReviewFinding {
  const severity = normalizeSeverity(finding.severity);
  const needsEvidenceDowngrade = (severity === 'critical' || severity === 'high') && !finding.evidence;
  const nextSeverity = needsEvidenceDowngrade ? 'info' : severity;
  return {
    ...finding,
    severity: nextSeverity,
    summary: needsEvidenceDowngrade
      ? `[unverified ${severity}] ${finding.summary}`
      : finding.summary,
    evidence: finding.evidence,
    blocking: Boolean(finding.blocking && (nextSeverity === 'critical' || nextSeverity === 'high')),
    contributingSpecialists: normalizeSpecialistList([
      ...(finding.contributingSpecialists ?? []),
      ...(finding.specialist ? [finding.specialist] : []),
    ]),
  };
}

export function buildSpecialistPrompt(
  ctx: WorkflowContext,
  diff: string,
  specialist: ReviewSpecialist,
  rules = specialistReviewRules(ctx.cwd, specialist),
  impact?: ReviewImpactContext,
): string {
  const sharedRubric = readSharedReviewAsset('shared-rubric.md');
  const schemaAsset = readSharedReviewAsset('findings-schema.md');
  const checklist = readSharedReviewAsset('checklist.md');
  return [
    `GOLDBAND_REVIEW_SPECIALIST=${specialist}`,
    'Read-only specialist review. Do not edit files. Do not run repair workflows.',
    REVIEW_NON_INTERACTIVE_COMMAND_POLICY,
    'Use the diff to define scope, then inspect the repository outside the diff when needed to trace authoritative owners, producers, consumers, routes, registrations, facades, and sibling implementations.',
    'Repository inspection is read-only. Never mutate files or repository state.',
    `Responsibility: ${SPECIALIST_GUIDANCE[specialist]}`,
    reviewIterationContext(ctx),
    sharedRubric,
    schemaAsset,
    checklist,
    'APPLICABLE_GOLDBAND_RULES_START',
    rules.text,
    'APPLICABLE_GOLDBAND_RULES_END',
    impact ? formatReviewImpactContext(impact) : '',
    'Return only JSON matching the supplied output schema: {"findings":[...]}',
    'Only report a finding when you can name an exact file and line, a concrete input or runtime state with a reachable execution path, and the incorrect result plus practical impact.',
    'Do not report style preferences, generic best practices, speculative risks, or test gaps without a demonstrated behavioral defect.',
    'DIFF_START',
    diff,
    'DIFF_END',
  ].join('\n\n');
}

export function unwrapFindings(parsed: unknown): ReviewFinding[] {
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { findings?: unknown }).findings)) {
    return (parsed as { findings: ReviewFinding[] }).findings;
  }
  if (Array.isArray(parsed)) return parsed as ReviewFinding[];
  throw new Error('review output must be an array or { findings: [...] }');
}

async function runBounded<T>(
  jobs: Array<() => Promise<T>>,
  concurrency: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(jobs.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < jobs.length) {
      const index = next;
      next += 1;
      try {
        results[index] = { status: 'fulfilled', value: await jobs[index]() };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker()));
  return results;
}

function normalizeSpecialistFindings(
  findings: ReviewFinding[],
  specialist: ReviewSpecialist,
): ReviewFinding[] {
  return findings.map((finding) => ({
    ...finding,
    specialist: finding.specialist ?? specialist,
    category: finding.category ?? specialist,
  }));
}

function capabilityFinding(host: string, reason: string): ReviewFinding {
  return {
    file: '__review_runtime__',
    severity: 'info',
    summary: `Specialist review degraded on ${host}: ${reason}.`,
    evidence: reason,
    recommendation: 'Use a host adapter with read-only parallel review support before treating specialist coverage as complete.',
    suggestedVerification: 'Run review code with --mode real --host codex or another adapter that advertises readOnlyEnforced and parallelDispatch.',
    category: 'host-capability',
    failureScenario: 'The report would otherwise imply specialist coverage that was not enforced by runtime capability.',
    blocking: false,
  };
}

function specialistFailureFinding(specialist: ReviewSpecialist, reason: unknown): ReviewFinding {
  const message = reason instanceof Error ? reason.message : String(reason);
  return {
    file: '__review_specialists__',
    severity: 'info',
    summary: `${specialist} specialist review failed.`,
    evidence: message,
    recommendation: 'Treat specialist coverage as incomplete and rerun after fixing the host/runtime failure.',
    suggestedVerification: `Rerun the ${specialist} specialist pass successfully.`,
    category: 'specialist-runtime',
    specialist,
    failureScenario: 'A specialist pass failed, so the aggregate review can miss scoped risks.',
    blocking: false,
  };
}

function assertSpecialistCoverageComplete(
  mode: SpecialistMode,
  failures: ReviewFinding[],
): void {
  if (mode !== 'all' || failures.length === 0) return;
  const details = failures
    .map(
      (failure) =>
        `${failure.specialist ?? 'host'}: ${failure.evidence ?? failure.summary}`,
    )
    .join('; ');
  throw new Error(`Exhaustive specialist coverage incomplete: ${details}`);
}

function mergeFindings(a: ReviewFinding, b: ReviewFinding): ReviewFinding {
  return {
    ...a,
    severity: higherSeverity(a.severity, b.severity),
    evidence: mostSpecific(a.evidence, b.evidence),
    recommendation: mostSpecific(a.recommendation, b.recommendation),
    suggestedVerification: mostSpecific(a.suggestedVerification, b.suggestedVerification),
    ruleId: mostSpecific(a.ruleId, b.ruleId),
    policySource: mostSpecific(a.policySource, b.policySource),
    blocking: Boolean(a.blocking || b.blocking),
    contributingSpecialists: normalizeSpecialistList([
      ...(a.contributingSpecialists ?? []),
      ...(b.contributingSpecialists ?? []),
      ...(a.specialist ? [a.specialist] : []),
      ...(b.specialist ? [b.specialist] : []),
    ]),
  };
}

function stableFindingKey(finding: ReviewFinding): string {
  if (finding.category === 'specialist-skipped') {
    return [
      finding.file,
      finding.category,
      finding.specialist ?? '',
      normalizeKeyText(finding.summary),
    ].join('\0');
  }

  return [
    finding.file,
    finding.line ?? '',
    finding.category ?? '',
    normalizeKeyText(finding.failureScenario ?? finding.summary),
  ].join('\0');
}

function compareFindings(a: ReviewFinding, b: ReviewFinding): number {
  return (
    REVIEW_SEVERITIES.indexOf(a.severity) - REVIEW_SEVERITIES.indexOf(b.severity) ||
    a.file.localeCompare(b.file) ||
    (a.line ?? 0) - (b.line ?? 0) ||
    (a.category ?? '').localeCompare(b.category ?? '')
  );
}

function higherSeverity(a: ReviewFinding['severity'], b: ReviewFinding['severity']): ReviewFinding['severity'] {
  return REVIEW_SEVERITIES.indexOf(a) <= REVIEW_SEVERITIES.indexOf(b) ? a : b;
}

function normalizeSeverity(severity: ReviewFinding['severity']): ReviewFinding['severity'] {
  return REVIEW_SEVERITIES.includes(severity) ? severity : 'info';
}

function mostSpecific(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return b.length > a.length ? b : a;
}

function normalizeSpecialistList(values: string[]): string[] | undefined {
  const list = [...new Set(values.filter(Boolean))].sort();
  return list.length > 0 ? list : undefined;
}

function normalizeKeyText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function readSharedReviewAsset(name: string): string {
  return readFileSync(workflowAssetPath(`review/${name}`), 'utf8');
}

function reviewIterationContext(ctx: WorkflowContext): string {
  const iteration = ctx.iterationContext?.iteration;
  if (!iteration) return 'GOLDBAND_SINGLE_PASS=1';
  return [
    `GOLDBAND_LOOP_ITERATION=${iteration}`,
    'Previous validated findings:',
    JSON.stringify(ctx.iterationContext?.previousFindings ?? []),
    'Focus on whether previous findings are resolved and whether new issues appeared.',
  ].join('\n');
}
