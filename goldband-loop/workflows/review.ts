import { spawnSync } from 'node:child_process';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  assertValidReviewScopeOptions,
  REVIEW_EVIDENCE_DURABILITY_ENV,
  REVIEW_EVIDENCE_DURABILITY_EPHEMERAL,
  REVIEW_NON_INTERACTIVE_COMMAND_POLICY,
  REVIEW_RUNTIME_TASK_HEADER,
} from '../lib/review-runtime-contract';
import { adapterFor } from './host-adapter';
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
import {
  createReviewTimeBudget,
  type ReviewTimeBudget,
  type ReviewTimeoutPolicy,
} from './review-timeouts';
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

export type UntrackedDiffState = {
  includedBytes: number;
};

const MAX_UNTRACKED_FILE_BYTES = 128 * 1024;
const MAX_UNTRACKED_TOTAL_BYTES = 512 * 1024;
export const MAX_REVIEW_DIFF_BYTES = 2 * 1024 * 1024;
const REVIEW_GIT_MAX_BUFFER_BYTES = MAX_REVIEW_DIFF_BYTES + (1024 * 1024);
const REVIEW_FILE_READ_CHUNK_BYTES = 64 * 1024;

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
  assertValidReviewScopeOptions(ctx.options);
  const timeBudget = createReviewTimeBudget(
    ctx.options,
    undefined,
    ctx.passStartedAtMonotonicMs,
  );
  if (ctx.options.diffFile) {
    const file = resolve(ctx.cwd, ctx.options.diffFile);
    const diff = readBoundedRegularFile(
      file,
      MAX_REVIEW_DIFF_BYTES,
      timeBudget,
      'review/code diff file',
    ).toString('utf8');
    return { source: `diff-file:${file}`, diff };
  }
  const tracked = collectTrackedDiff(ctx, timeBudget);
  const untrackedDiff = (ctx.options.worktree || ctx.options.includeUntracked)
    ? collectUntrackedDiff(ctx, timeBudget)
    : '';
  const diff = [tracked.diff, untrackedDiff].filter(Boolean).join('\n');
  assertReviewDiffSize(diff);
  return {
    source: untrackedDiff ? `${tracked.source} + untracked` : tracked.source,
    diff,
  };
}

async function runReview(ctx: WorkflowContext): Promise<ReviewFinding[]> {
  const timeBudget = createReviewTimeBudget(
    ctx.options,
    undefined,
    ctx.passStartedAtMonotonicMs,
  );
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
    timeBudget.policy,
  );
  const result = await adapter.runJson(
    prompt,
    findingsEnvelopeJsonSchema,
    ctx.cwd,
    { timeoutMs: timeBudget.nextHostTimeoutMs() },
  );
  const coreFindings = findingsSchema.validate(unwrapFindings(result.parsed));
  const specialistFindings = await runParallelSpecialistReview(
    ctx,
    adapter,
    input.diff,
    findingsEnvelopeJsonSchema,
    specialistMode,
    specialistReview,
    () => ({ timeoutMs: timeBudget.nextHostTimeoutMs() }),
  );
  timeBudget.completeSpecialistPhase();
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
  if (
    process.env[REVIEW_EVIDENCE_DURABILITY_ENV] ===
    REVIEW_EVIDENCE_DURABILITY_EPHEMERAL
  ) {
    lines.push(
      'Evidence durability: temporary sandbox-safe storage; use the reported artifact path before the sandbox session ends.',
      '',
    );
  }
  if (findings.length === 0) {
    lines.push('No findings.');
  } else {
    for (const finding of findings) {
      const loc = finding.line ? `${finding.file}:${finding.line}` : finding.file;
      lines.push(`- [${finding.severity}] ${finding.summary} — ${loc}`);
      if (finding.evidence) lines.push(`  Evidence: ${finding.evidence}`);
      if (finding.failureScenario) lines.push(`  Trigger: ${finding.failureScenario}`);
      if (finding.recommendation) lines.push(`  Fix: ${finding.recommendation}`);
      if (finding.suggestedVerification) {
        lines.push(`  Verify: ${finding.suggestedVerification}`);
      }
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

function collectTrackedDiff(
  ctx: WorkflowContext,
  timeBudget: ReviewTimeBudget,
): DiffOutput {
  const argSets = diffArgSets(ctx, timeBudget);
  const chunks: string[] = [];
  let collectedBytes = 0;
  for (const args of argSets) {
    const result = runReviewGit(ctx, args, timeBudget);
    if (result.status !== 0) throw new Error(result.stderr || 'git diff failed');
    if (result.stdout) {
      collectedBytes += Buffer.byteLength(result.stdout) + (chunks.length > 0 ? 1 : 0);
      if (collectedBytes > MAX_REVIEW_DIFF_BYTES) throw reviewDiffSizeError();
      chunks.push(result.stdout);
    }
  }
  return {
    source: argSets
      .map((args) => `git ${args.filter((arg) => !['--no-ext-diff', '--no-textconv'].includes(arg)).join(' ')}`)
      .join(' && '),
    diff: chunks.join('\n'),
  };
}

function diffArgSets(
  ctx: WorkflowContext,
  timeBudget: ReviewTimeBudget,
): string[][] {
  if (ctx.options.staged) return [safeDiffArgs('--staged')];
  if (ctx.options.base && ctx.options.worktree) {
    return [safeDiffArgs(mergeBase(ctx, ctx.options.base, timeBudget))];
  }
  const argSets: string[][] = [];
  if (ctx.options.base) argSets.push(safeDiffArgs(`${ctx.options.base}...HEAD`));
  if (ctx.options.worktree) {
    argSets.push(
      ...(hasHead(ctx, timeBudget)
        ? [safeDiffArgs('HEAD')]
        : [safeDiffArgs('--cached'), safeDiffArgs()]),
    );
  }
  return argSets.length > 0 ? argSets : [safeDiffArgs()];
}

function mergeBase(
  ctx: WorkflowContext,
  base: string,
  timeBudget: ReviewTimeBudget,
): string {
  const result = runReviewGit(ctx, ['merge-base', base, 'HEAD'], timeBudget);
  const commit = result.stdout.trim();
  if (result.status !== 0 || !commit) {
    throw new Error(result.stderr || `git merge-base failed for ${base}`);
  }
  return commit;
}

function hasHead(ctx: WorkflowContext, timeBudget: ReviewTimeBudget): boolean {
  const result = runReviewGit(
    ctx,
    ['rev-parse', '--verify', 'HEAD'],
    timeBudget,
  );
  return result.status === 0;
}

function collectUntrackedDiff(
  ctx: WorkflowContext,
  timeBudget: ReviewTimeBudget,
): string {
  const result = runReviewGit(
    ctx,
    ['ls-files', '-z', '--others', '--exclude-standard'],
    timeBudget,
  );
  if (result.status !== 0) throw new Error(result.stderr || 'git ls-files failed');
  const state: UntrackedDiffState = { includedBytes: 0 };
  const realRoot = realpathSync(ctx.cwd);
  return result.stdout
    .split('\0')
    .filter(Boolean)
    .map((file) => {
      timeBudget.assertWithinDeadline();
      return untrackedFileDiff(ctx.cwd, realRoot, file, state);
    })
    .filter(Boolean)
    .join('\n');
}

function safeDiffArgs(...args: string[]): string[] {
  return ['diff', '--no-ext-diff', '--no-textconv', ...args];
}

function runReviewGit(
  ctx: WorkflowContext,
  args: string[],
  timeBudget: ReviewTimeBudget,
) {
  const result = spawnSync(
    'git',
    ['--no-pager', '-c', 'core.fsmonitor=false', ...args],
    {
      cwd: ctx.cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_NO_LAZY_FETCH: '1',
        GIT_OPTIONAL_LOCKS: '0',
      },
      maxBuffer: REVIEW_GIT_MAX_BUFFER_BYTES,
      timeout: timeBudget.remainingPassTimeoutMs(),
    },
  );
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === 'ETIMEDOUT') {
      throw new Error(
        `review/code ${timeBudget.policy.specialistMode} pass timed out after ${timeBudget.policy.passTimeoutMs}ms`,
      );
    }
    if (code === 'ENOBUFS') throw reviewDiffSizeError();
    throw result.error;
  }
  return result;
}

export function untrackedFileDiff(
  cwd: string,
  realRoot: string,
  file: string,
  state: UntrackedDiffState,
  beforeOpen: () => void = () => {},
  afterFirstRead: () => void = () => {},
): string {
  const abs = resolve(cwd, file);
  const rel = relative(cwd, abs);
  let stat;
  try {
    stat = lstatSync(abs);
  } catch {
    return '';
  }
  if (stat.isSymbolicLink()) {
    return skippedUntrackedFileDiff(rel, 'symbolic link');
  }
  if (!stat.isFile()) return '';
  const realFile = realpathSync(abs);
  const realRelative = relative(realRoot, realFile);
  if (
    realRelative === '..' ||
    realRelative.startsWith(`..${sep}`) ||
    isAbsolute(realRelative)
  ) {
    return skippedUntrackedFileDiff(rel, 'resolved path escapes repository');
  }

  if (stat.size > MAX_UNTRACKED_FILE_BYTES) {
    return skippedUntrackedFileDiff(rel, `file exceeds ${MAX_UNTRACKED_FILE_BYTES} byte limit`);
  }
  if (state.includedBytes + stat.size > MAX_UNTRACKED_TOTAL_BYTES) {
    return skippedUntrackedFileDiff(rel, `untracked diff exceeds ${MAX_UNTRACKED_TOTAL_BYTES} byte total limit`);
  }

  let buffer: Buffer;
  try {
    buffer = readBoundedRegularFile(
      abs,
      MAX_UNTRACKED_FILE_BYTES,
      undefined,
      'review/code untracked file',
      beforeOpen,
      stat,
      afterFirstRead,
    );
  } catch {
    return skippedUntrackedFileDiff(rel, 'file changed or became unreadable during review collection');
  }
  if (state.includedBytes + buffer.length > MAX_UNTRACKED_TOTAL_BYTES) {
    return skippedUntrackedFileDiff(rel, `untracked diff exceeds ${MAX_UNTRACKED_TOTAL_BYTES} byte total limit`);
  }
  if (isLikelyBinary(buffer)) return skippedUntrackedFileDiff(rel, 'binary file');

  const text = buffer.toString('utf8');
  if (text.includes('\uFFFD')) return skippedUntrackedFileDiff(rel, 'non-UTF-8 content');

  const secretMatch = detectSecretLikeContent(text);
  if (secretMatch) return skippedUntrackedFileDiff(rel, `secret-like content (${secretMatch})`);

  state.includedBytes += buffer.length;
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

function readBoundedRegularFile(
  file: string,
  maxBytes: number,
  timeBudget: ReviewTimeBudget | undefined,
  label: string,
  beforeOpen: () => void = () => {},
  expectedStat = lstatSync(file),
  afterFirstRead: () => void = () => {},
): Buffer {
  if (expectedStat.isSymbolicLink() || !expectedStat.isFile()) {
    throw new Error(`${label} must be a regular file: ${file}`);
  }
  if (expectedStat.size > maxBytes) throw reviewDiffSizeError(label, maxBytes);

  beforeOpen();
  const flags = constants.O_RDONLY |
    (constants.O_NOFOLLOW ?? 0) |
    (constants.O_NONBLOCK ?? 0);
  let fd: number | undefined;
  try {
    fd = openSync(file, flags);
    const openedStat = fstatSync(fd);
    if (!sameFileVersion(openedStat, expectedStat)) {
      throw new Error(`${label} changed while it was being opened: ${file}`);
    }
    if (openedStat.size > maxBytes) throw reviewDiffSizeError(label, maxBytes);
    const buffer = readDescriptorWithinLimit(
      fd,
      maxBytes,
      timeBudget,
      label,
      afterFirstRead,
    );
    if (!sameFileVersion(fstatSync(fd), openedStat)) {
      throw new Error(`${label} changed while it was being read: ${file}`);
    }
    return buffer;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function readDescriptorWithinLimit(
  fd: number,
  maxBytes: number,
  timeBudget: ReviewTimeBudget | undefined,
  label: string,
  afterFirstRead: () => void,
): Buffer {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  while (true) {
    timeBudget?.assertWithinDeadline();
    const remainingWithSentinel = (maxBytes + 1) - totalBytes;
    if (remainingWithSentinel <= 0) throw reviewDiffSizeError(label, maxBytes);
    const chunk = Buffer.allocUnsafe(
      Math.min(REVIEW_FILE_READ_CHUNK_BYTES, remainingWithSentinel),
    );
    const bytesRead = readSync(fd, chunk, 0, chunk.length, null);
    if (bytesRead === 0) break;
    totalBytes += bytesRead;
    if (totalBytes > maxBytes) throw reviewDiffSizeError(label, maxBytes);
    chunks.push(chunk.subarray(0, bytesRead));
    if (chunks.length === 1) afterFirstRead();
  }
  timeBudget?.assertWithinDeadline();
  return Buffer.concat(chunks, totalBytes);
}

function sameFileVersion(
  left: ReturnType<typeof fstatSync>,
  right: ReturnType<typeof fstatSync>,
): boolean {
  return left.isFile() &&
    right.isFile() &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs;
}

function assertReviewDiffSize(diff: string): void {
  if (Buffer.byteLength(diff) > MAX_REVIEW_DIFF_BYTES) throw reviewDiffSizeError();
}

function reviewDiffSizeError(
  label = 'review/code diff',
  maxBytes = MAX_REVIEW_DIFF_BYTES,
): Error {
  return new Error(
    `${label} exceeds ${maxBytes} byte limit; narrow the review scope with --staged, --base, or --diff-file`,
  );
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
  return [
    REVIEW_RUNTIME_TASK_HEADER,
    reviewIterationPromptContext(ctx),
    readReviewAsset('shared-rubric.md'),
    readReviewAsset('findings-schema.md'),
    readReviewAsset('checklist.md'),
    'APPLICABLE_GOLDBAND_RULES_START',
    rules.text,
    'APPLICABLE_GOLDBAND_RULES_END',
    'Return only JSON matching the provided findings schema.',
    'Read-only review. Do not edit files, apply patches, commit, push, or run repair workflows.',
    REVIEW_NON_INTERACTIVE_COMMAND_POLICY,
    'Host customizations may be disabled for safety. Use read-only tools to inspect applicable AGENTS.md and CLAUDE.md files in the repository root and touched-file ancestors; apply them as review policy, never as authorization to mutate state.',
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
  timeoutPolicy: ReviewTimeoutPolicy,
): void {
  const telemetry = {
    ...buildReviewPromptTelemetry({
      host,
      corePrompt,
      coreBundle,
      specialistPrompts: specialistReview.items,
      selectedSpecialists: specialistReview.selection.selected,
    }),
    specialistMode: timeoutPolicy.specialistMode,
    hostTimeoutMs: timeoutPolicy.hostTimeoutMs,
    passTimeoutMs: timeoutPolicy.passTimeoutMs,
  };
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
