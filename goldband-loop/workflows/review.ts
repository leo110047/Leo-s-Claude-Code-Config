import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { adapterFor, workflowLabelFromTemplate } from './host-adapter';
import { evidencePath, stateRoot } from './evidence';
import { workflowAssetPath } from './paths';
import {
  aggregateReviewFindings,
  prepareSpecialistReview,
  runParallelSpecialistReview,
  unwrapFindings,
  type PreparedSpecialistReview,
} from './review-engine';
import {
  buildReviewPromptTelemetry,
  createReviewRulesSnapshot,
  coreReviewRules,
  type RulesBundle,
} from './review-rules';
import { findingsSchema, normalizeFindings, textSchema } from './schema';
import type {
  EvaluationSignalSnapshot,
  ReviewFinding,
  SeverityCounts,
  WorkflowContext,
  WorkflowStep,
} from './types';

type DiffOutput = {
  source: string;
  diff: string;
};

type UntrackedDiffState = {
  includedBytes: number;
};

const MAX_UNTRACKED_FILE_BYTES = 128 * 1024;
const MAX_UNTRACKED_TOTAL_BYTES = 512 * 1024;

const diffSchema = {
  name: 'review-diff',
  validate(value: unknown): DiffOutput {
    if (!value || typeof value !== 'object') throw new Error('expected diff object');
    const item = value as Record<string, unknown>;
    if (typeof item.source !== 'string') throw new Error('diff.source required');
    if (typeof item.diff !== 'string') throw new Error('diff.diff required');
    return { source: item.source, diff: item.diff };
  },
};

export const reviewSteps: WorkflowStep[] = [
  { name: 'collect-diff', kind: 'typed', produces: diffSchema, run: collectDiff },
  { name: 'run-review', kind: 'llm', produces: findingsSchema, run: runReview },
  { name: 'parse-findings', kind: 'typed', produces: findingsSchema, run: parseFindings },
  { name: 'verify-findings', kind: 'typed', produces: findingsSchema, run: verifyFindings },
  { name: 'render-report', kind: 'typed', produces: textSchema, run: renderReport },
];

export function reviewSignalFromOutput(
  output: unknown,
  _ctx: WorkflowContext,
  stepName: string,
): EvaluationSignalSnapshot | undefined {
  if (!['run-review', 'parse-findings', 'verify-findings'].includes(stepName)) return undefined;
  return reviewFindingsSignal(findingsSchema.validate(output));
}

export function reviewTargetMet(signal: EvaluationSignalSnapshot): boolean {
  return signal.kind === 'review-findings' && signal.findingCount === 0;
}

export function captureReviewIterationState(
  output: unknown,
  _ctx: WorkflowContext,
  stepName: string,
) {
  if (stepName !== 'verify-findings') return undefined;
  return { previousFindings: findingsSchema.validate(output) };
}

function collectDiff(ctx: WorkflowContext): DiffOutput {
  if (ctx.options.diffFile) {
    const file = resolve(ctx.cwd, ctx.options.diffFile);
    return { source: `diff-file:${file}`, diff: readFileSync(file, 'utf8') };
  }
  const tracked = collectTrackedDiff(ctx);
  const untrackedDiff = (ctx.options.worktree || ctx.options.includeUntracked)
    ? collectUntrackedDiff(ctx.cwd)
    : '';
  return {
    source: untrackedDiff ? `${tracked.source} + untracked` : tracked.source,
    diff: [tracked.diff, untrackedDiff].filter(Boolean).join('\n'),
  };
}

async function runReview(ctx: WorkflowContext): Promise<ReviewFinding[]> {
  const input = diffSchema.validate(ctx.input);
  const adapter = adapterFor(reviewHost(ctx));
  const rulesSnapshot = createReviewRulesSnapshot(ctx.cwd);
  const coreRules = coreReviewRules(ctx.cwd, input.diff, rulesSnapshot);
  const prompt = buildReviewPrompt(ctx, input.diff, coreRules);
  const specialistMode = ctx.options.specialists ?? 'auto';
  const specialistReview = prepareSpecialistReview(
    ctx,
    input.diff,
    specialistMode,
    rulesSnapshot,
  );
  recordReviewPromptTelemetry(
    ctx,
    adapter.name,
    prompt,
    coreRules.bundle,
    specialistReview,
  );
  const result = await adapter.runJson(
    prompt,
    findingsEnvelopeJsonSchema,
    ctx.cwd,
  );
  const coreFindings = findingsSchema.validate(unwrapFindings(result.parsed));
  const specialistFindings = await runParallelSpecialistReview(
    ctx,
    adapter,
    input.diff,
    findingsEnvelopeJsonSchema,
    specialistMode,
    specialistReview,
  );
  return aggregateReviewFindings([...coreFindings, ...specialistFindings]);
}

function parseFindings(ctx: WorkflowContext): ReviewFinding[] {
  return aggregateReviewFindings(normalizeFindings(findingsSchema.validate(ctx.input)));
}

function verifyFindings(ctx: WorkflowContext): ReviewFinding[] {
  return aggregateReviewFindings(findingsSchema.validate(ctx.input))
    .filter((finding) => isRuntimeDiagnostic(finding) || hasConcreteFailurePath(finding));
}

function renderReport(ctx: WorkflowContext): string {
  const findings = findingsSchema.validate(ctx.input);
  const lines = [
    '# review/code runtime report',
    '',
    'Read-only review: no files were modified.',
    '',
  ];
  if (findings.length === 0) {
    lines.push('No findings.');
  } else {
    for (const finding of findings) {
      const loc = finding.line ? `${finding.file}:${finding.line}` : finding.file;
      lines.push(`- [${finding.severity}] ${finding.summary} — ${loc}`);
      if (finding.failureScenario) lines.push(`  Trigger: ${finding.failureScenario}`);
      if (finding.recommendation) lines.push(`  Fix: ${finding.recommendation}`);
    }
  }
  const report = `${lines.join('\n')}\n`;
  const dir = join(stateRoot(ctx.options), 'workflow-runs', 'artifacts');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, reportArtifactName(ctx));
  writeFileSync(file, report);
  ctx.artifacts.push(file, evidencePath(ctx.workflow.name, ctx.options));
  return report;
}

function collectTrackedDiff(ctx: WorkflowContext): DiffOutput {
  const argSets = diffArgSets(ctx);
  const chunks: string[] = [];
  for (const args of argSets) {
    const result = spawnSync('git', args, { cwd: ctx.cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || 'git diff failed');
    if (result.stdout) chunks.push(result.stdout);
  }
  return {
    source: argSets.map((args) => `git ${args.join(' ')}`).join(' && '),
    diff: chunks.join('\n'),
  };
}

function diffArgSets(ctx: WorkflowContext): string[][] {
  if (ctx.options.staged) return [['diff', '--staged']];
  if (ctx.options.base) return [['diff', `${ctx.options.base}...HEAD`]];
  if (ctx.options.worktree) {
    return hasHead(ctx.cwd) ? [['diff', 'HEAD']] : [['diff', '--cached'], ['diff']];
  }
  return [['diff']];
}

function hasHead(cwd: string): boolean {
  const result = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], {
    cwd,
    encoding: 'utf8',
  });
  return result.status === 0;
}

function collectUntrackedDiff(cwd: string): string {
  const result = spawnSync('git', ['ls-files', '--others', '--exclude-standard'], {
    cwd,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr || 'git ls-files failed');
  const state: UntrackedDiffState = { includedBytes: 0 };
  return result.stdout
    .split('\n')
    .filter(Boolean)
    .map((file) => untrackedFileDiff(cwd, file, state))
    .filter(Boolean)
    .join('\n');
}

function untrackedFileDiff(cwd: string, file: string, state: UntrackedDiffState): string {
  const abs = resolve(cwd, file);
  if (!existsSync(abs)) return '';
  const stat = statSync(abs);
  if (!stat.isFile()) return '';
  const rel = relative(cwd, abs);

  if (stat.size > MAX_UNTRACKED_FILE_BYTES) {
    return skippedUntrackedFileDiff(rel, `file exceeds ${MAX_UNTRACKED_FILE_BYTES} byte limit`);
  }
  if (state.includedBytes + stat.size > MAX_UNTRACKED_TOTAL_BYTES) {
    return skippedUntrackedFileDiff(rel, `untracked diff exceeds ${MAX_UNTRACKED_TOTAL_BYTES} byte total limit`);
  }

  const buffer = readFileSync(abs);
  if (isLikelyBinary(buffer)) return skippedUntrackedFileDiff(rel, 'binary file');

  const text = buffer.toString('utf8');
  if (text.includes('\uFFFD')) return skippedUntrackedFileDiff(rel, 'non-UTF-8 content');

  const secretMatch = detectSecretLikeContent(text);
  if (secretMatch) return skippedUntrackedFileDiff(rel, `secret-like content (${secretMatch})`);

  state.includedBytes += stat.size;
  const body = text
    .split('\n')
    .map((line) => `+${line}`)
    .join('\n');
  const addedLineCount = text.split('\n').length;
  return [
    `diff --git a/${rel} b/${rel}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${rel}`,
    `@@ -0,0 +1,${addedLineCount} @@`,
    body,
  ].join('\n');
}

function skippedUntrackedFileDiff(rel: string, reason: string): string {
  return [
    `diff --git a/${rel} b/${rel}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${rel}`,
    '@@ -0,0 +1,1 @@',
    `+[[review/code skipped untracked file: ${reason}]]`,
  ].join('\n');
}

function isLikelyBinary(buffer: Buffer): boolean {
  if (buffer.includes(0)) return true;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  if (sample.length === 0) return false;
  let suspicious = 0;
  for (const byte of sample) {
    const allowedControl = byte === 9 || byte === 10 || byte === 13;
    if (byte < 32 && !allowedControl) suspicious++;
  }
  return suspicious / sample.length > 0.02;
}

function detectSecretLikeContent(text: string): string | null {
  const patterns: Array<[string, RegExp]> = [
    ['openai-api-key', /\bsk-[A-Za-z0-9_-]{20,}\b/],
    ['github-token', /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/],
    ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/],
    ['private-key-block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
    [
      'credential-assignment',
      /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|secret|password|passwd|client[_-]?secret)\b\s*[:=]\s*['"]?[^\s'"]{6,}/i,
    ],
  ];
  for (const [name, pattern] of patterns) {
    if (pattern.test(text)) return name;
  }
  return null;
}

function hasConcreteFailurePath(finding: ReviewFinding): boolean {
  return Boolean(finding.line && finding.evidence && finding.failureScenario);
}

function isRuntimeDiagnostic(finding: ReviewFinding): boolean {
  return finding.category === 'host-capability' || finding.category === 'specialist-runtime';
}

function reviewHost(ctx: WorkflowContext): 'mock' | 'claude' | 'codex' {
  if (ctx.options.mode !== 'real') return 'mock';
  if (ctx.options.host === 'claude' || ctx.options.host === 'codex') return ctx.options.host;
  throw new Error('--mode real requires --host claude or --host codex');
}

export function buildReviewPrompt(
  ctx: WorkflowContext,
  diff: string,
  rules = coreReviewRules(ctx.cwd, diff),
): string {
  const template = readFileSync(workflowAssetPath(ctx.workflow.sourceTemplate), 'utf8');
  const label = workflowLabelFromTemplate(template);
  return [
    `${label}`,
    reviewIterationPromptContext(ctx),
    readReviewAsset('shared-rubric.md'),
    readReviewAsset('findings-schema.md'),
    readReviewAsset('checklist.md'),
    'APPLICABLE_GOLDBAND_RULES_START',
    rules.text,
    'APPLICABLE_GOLDBAND_RULES_END',
    'Return only JSON matching the provided findings schema.',
    'Read-only review. Do not edit files, apply patches, commit, push, or run repair workflows.',
    'Use the diff to define scope. Inspect the read-only repository outside the diff when needed to verify wiring, authoritative ownership, consumers, registrations, and dead code.',
    'Only report a finding when you can name an exact file and line, a concrete input or runtime state with a reachable execution path, and the incorrect result plus practical impact.',
    'Do not report style preferences, generic best practices, speculative risks, or test gaps without a demonstrated behavioral defect.',
    'DIFF_START',
    diff,
    'DIFF_END',
  ].join('\n');
}

function recordReviewPromptTelemetry(
  ctx: WorkflowContext,
  host: string,
  corePrompt: string,
  coreBundle: RulesBundle,
  specialistReview: PreparedSpecialistReview,
): void {
  const telemetry = buildReviewPromptTelemetry({
    host,
    corePrompt,
    coreBundle,
    specialistPrompts: specialistReview.items,
    selectedSpecialists: specialistReview.selection.selected,
  });
  const dir = join(stateRoot(ctx.options), 'workflow-runs', 'telemetry');
  mkdirSync(dir, { recursive: true });
  const iteration = ctx.iterationContext?.iteration;
  const suffix = iteration ? `-iteration-${iteration}` : '';
  const file = join(dir, `${ctx.runId}-review-prompt${suffix}.json`);
  writeFileSync(file, `${JSON.stringify(telemetry, null, 2)}\n`);
}

function readReviewAsset(name: string): string {
  return readFileSync(workflowAssetPath(`review/${name}`), 'utf8');
}

function reviewIterationPromptContext(ctx: WorkflowContext): string {
  const iteration = ctx.iterationContext?.iteration;
  if (!iteration) return 'GOLDBAND_SINGLE_PASS=1';
  const previous = ctx.iterationContext?.previousFindings ?? [];
  return [
    `GOLDBAND_LOOP_ITERATION=${iteration}`,
    'Previous validated findings:',
    JSON.stringify(previous),
    'Focus this round on whether previous findings are resolved and whether new issues appeared.',
  ].join('\n');
}

function reviewFindingsSignal(findings: ReviewFinding[]): EvaluationSignalSnapshot {
  const blockingFindings = findings.filter((finding) => finding.category !== 'specialist-skipped');
  const severityCounts = emptySeverityCounts();
  for (const finding of blockingFindings) severityCounts[finding.severity] += 1;
  return {
    kind: 'review-findings',
    findingCount: blockingFindings.length,
    severityCounts,
    blockerKey: blockingFindings.length > 0 ? blockingFindings.map(findingKey).sort().join('|') : undefined,
  };
}

function emptySeverityCounts(): SeverityCounts {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
}

function findingKey(finding: ReviewFinding): string {
  return [
    finding.file,
    finding.line ?? '',
    finding.severity,
    normalizeEvidenceKey(finding.evidence),
  ].join(':');
}

function reportArtifactName(ctx: WorkflowContext): string {
  const name = basename(ctx.workflow.name);
  const iteration = ctx.iterationContext?.iteration;
  return iteration ? `${ctx.runId}-${name}-iteration-${iteration}.md` : `${ctx.runId}-${name}.md`;
}

function normalizeEvidenceKey(value: string | undefined): string {
  if (!value) return 'no-evidence';
  const snippets = Array.from(value.matchAll(/`([^`]+)`/g), (match) => match[1]);
  const source = snippets.length > 0 ? snippets.join(' ') : value;
  const tokens = Array.from(source.matchAll(/[A-Za-z_$][A-Za-z0-9_$-]*/g), (match) => match[0].toLowerCase())
    .filter((token) => !EVIDENCE_KEY_STOPWORDS.has(token));
  const unique = [...new Set(tokens)].sort();
  if (unique.length > 0) return unique.join(' ');
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

const EVIDENCE_KEY_STOPWORDS = new Set([
  'a',
  'add',
  'added',
  'adds',
  'and',
  'as',
  'contains',
  'declaration',
  'define',
  'definition',
  'diff',
  'export',
  'file',
  'for',
  'function',
  'import',
  'inside',
  'local',
  'no',
  'or',
  'return',
  'shown',
  'still',
  'symbol',
  'the',
  'this',
  'true',
  'updated',
  'visible',
  'with',
]);

const findingsJsonSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      file: { type: 'string' },
      line: { type: ['number', 'null'] },
      severity: { enum: ['critical', 'high', 'medium', 'low', 'info'] },
      summary: { type: 'string' },
      evidence: { type: ['string', 'null'] },
      recommendation: { type: ['string', 'null'] },
      category: { type: ['string', 'null'] },
      ruleId: { type: ['string', 'null'] },
      policySource: { type: ['string', 'null'] },
      failureScenario: { type: ['string', 'null'] },
      suggestedVerification: { type: ['string', 'null'] },
      blocking: { type: ['boolean', 'null'] },
      specialist: { type: ['string', 'null'] },
      contributingSpecialists: {
        type: ['array', 'null'],
        items: { type: 'string' },
      },
    },
    required: [
      'file',
      'line',
      'severity',
      'summary',
      'evidence',
      'recommendation',
      'category',
      'ruleId',
      'policySource',
      'failureScenario',
      'suggestedVerification',
      'blocking',
      'specialist',
      'contributingSpecialists',
    ],
    additionalProperties: false,
  },
};

const findingsEnvelopeJsonSchema = {
  type: 'object',
  properties: {
    findings: findingsJsonSchema,
  },
  required: ['findings'],
  additionalProperties: false,
};
