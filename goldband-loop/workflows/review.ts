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
  assertValidReviewExecutionOptions,
  REVIEW_EVIDENCE_DURABILITY_ENV,
  REVIEW_EVIDENCE_DURABILITY_EPHEMERAL,
} from '../lib/review-runtime-contract';
import { evidencePath, stateRoot } from './evidence';
import { adapterFor, type HostUsage } from './host-adapter';
import { workflowAssetPath } from './paths';
import {
  aggregateReviewFindings,
  unwrapFindings,
} from './review-engine';
import {
  collectReviewImpactContext,
  formatReviewImpactContext,
  impactTelemetry,
  type ReviewDiffInput,
  type ReviewImpactContext,
  reviewDiffSchema,
  reviewInputSchema,
} from './review-impact';
import {
  buildReviewPromptTelemetry,
  coreReviewRules,
  createReviewRulesSnapshot,
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

export type UntrackedDiffState = {
  includedBytes: number;
};

const MAX_UNTRACKED_FILE_BYTES = 128 * 1024;
const MAX_UNTRACKED_TOTAL_BYTES = 512 * 1024;
export const MAX_REVIEW_DIFF_BYTES = 256 * 1024;
export const MAX_REVIEW_PROMPT_OVERHEAD_BYTES = 20 * 1024;
const REVIEW_GIT_MAX_BUFFER_BYTES = MAX_REVIEW_DIFF_BYTES + (1024 * 1024);
const REVIEW_FILE_READ_CHUNK_BYTES = 64 * 1024;

export const reviewSteps: WorkflowStep[] = [
  { name: 'collect-diff', kind: 'typed', produces: reviewDiffSchema, run: collectDiff },
  {
    name: 'collect-impact-context',
    kind: 'typed',
    produces: reviewInputSchema,
    run: collectImpactContext,
  },
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

function collectDiff(ctx: WorkflowContext): ReviewDiffInput {
  assertValidReviewExecutionOptions(ctx.options);
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
    return {
      source: `diff-file:${file}`,
      diff,
      changedFiles: changedFilesFromPatch(diff),
    };
  }
  const tracked = collectTrackedDiff(ctx, timeBudget);
  const untracked = (ctx.options.worktree || ctx.options.includeUntracked)
    ? collectUntrackedDiff(ctx, timeBudget)
    : { diff: '', files: [] };
  const diff = [tracked.diff, untracked.diff].filter(Boolean).join('\n');
  assertReviewDiffSize(diff);
  return {
    source: untracked.diff ? `${tracked.source} + untracked` : tracked.source,
    diff,
    changedFiles: normalizedChangedFiles([
      ...tracked.changedFiles,
      ...untracked.files,
    ]),
  };
}

function collectImpactContext(ctx: WorkflowContext) {
  const input = reviewDiffSchema.validate(ctx.input);
  const timeBudget = createReviewTimeBudget(
    ctx.options,
    undefined,
    ctx.passStartedAtMonotonicMs,
  );
  return collectReviewImpactContext(ctx, input, timeBudget);
}

async function runReview(ctx: WorkflowContext): Promise<ReviewFinding[]> {
  const timeBudget = createReviewTimeBudget(
    ctx.options,
    undefined,
    ctx.passStartedAtMonotonicMs,
  );
  const input = reviewInputSchema.validate(ctx.input);
  const adapter = adapterFor(reviewHost(ctx));
  const rulesSnapshot = createReviewRulesSnapshot(ctx.cwd);
  const coreRules = coreReviewRules(
    ctx.cwd,
    input.diff,
    rulesSnapshot,
    input.impact.changedFiles,
  );
  const prompt = buildReviewPrompt(ctx, input.diff, coreRules, input.impact);
  recordReviewPromptTelemetry(
    ctx,
    adapter.name,
    prompt,
    coreRules.bundle,
    coreRules.text,
    input.diff,
    timeBudget.policy,
    input.impact,
  );
  const result = await adapter.runJson(
    prompt,
    findingsEnvelopeJsonSchema,
    ctx.cwd,
    { timeoutMs: timeBudget.nextHostTimeoutMs() },
  );
  recordReviewHostUsage(ctx, adapter.name, result.usage);
  const coreFindings = findingsSchema.validate(unwrapFindings(result.parsed));
  return aggregateReviewFindings(coreFindings);
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
): ReviewDiffInput {
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
    changedFiles: collectTrackedPaths(ctx, argSets, timeBudget),
  };
}

function collectTrackedPaths(
  ctx: WorkflowContext,
  argSets: string[][],
  timeBudget: ReviewTimeBudget,
): string[] {
  const files: string[] = [];
  for (const args of argSets) {
    const [command, ...rest] = args;
    if (command !== 'diff') throw new Error('review/code internal diff command mismatch');
    const result = runReviewGit(
      ctx,
      ['diff', '--name-only', '-z', ...rest],
      timeBudget,
    );
    if (result.status !== 0) throw new Error(result.stderr || 'git diff --name-only failed');
    files.push(...result.stdout.split('\0').filter(Boolean));
  }
  return normalizedChangedFiles(files);
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
): { diff: string; files: string[] } {
  const result = runReviewGit(
    ctx,
    ['ls-files', '-z', '--others', '--exclude-standard'],
    timeBudget,
  );
  if (result.status !== 0) throw new Error(result.stderr || 'git ls-files failed');
  const state: UntrackedDiffState = { includedBytes: 0 };
  const realRoot = realpathSync(ctx.cwd);
  const chunks: string[] = [];
  const files: string[] = [];
  for (const file of result.stdout.split('\0').filter(Boolean)) {
    timeBudget.assertWithinDeadline();
    const output = untrackedFileDiff(ctx.cwd, realRoot, file, state);
    if (!output) continue;
    chunks.push(output);
    if (!output.includes('[[review/code skipped untracked file:')) files.push(file);
  }
  return { diff: chunks.join('\n'), files: normalizedChangedFiles(files) };
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
  impact?: ReviewImpactContext,
): string {
  const prompt = [
    readReviewAsset('shared-rubric.md'),
    readReviewAsset('checklist.md'),
    'APPLICABLE_GOLDBAND_RULES_START',
    rules.text,
    'APPLICABLE_GOLDBAND_RULES_END',
    impact ? formatReviewImpactContext(impact) : '',
    'Inspect applicable AGENTS.md and CLAUDE.md files in the repository root and touched-file ancestors as review policy.',
    'Use the diff to define scope. Inspect repository context outside the diff when needed to verify wiring, authoritative ownership, consumers, registrations, and dead code.',
    'DIFF_START',
    diff,
    'DIFF_END',
  ].join('\n');
  const overheadBytes = Buffer.byteLength(prompt) - Buffer.byteLength(diff);
  if (overheadBytes > MAX_REVIEW_PROMPT_OVERHEAD_BYTES) {
    throw new Error(
      `review prompt overhead exceeds budget: actualBytes=${overheadBytes} limit=${MAX_REVIEW_PROMPT_OVERHEAD_BYTES}`,
    );
  }
  return prompt;
}

function recordReviewPromptTelemetry(
  ctx: WorkflowContext,
  host: string,
  corePrompt: string,
  coreBundle: RulesBundle,
  coreRulesText: string,
  diff: string,
  timeoutPolicy: ReviewTimeoutPolicy,
  impact: ReviewImpactContext,
): void {
  const telemetry = {
    ...buildReviewPromptTelemetry({
      host,
      corePrompt,
      coreBundle,
      coreRulesText,
      diff,
    }),
    specialistMode: timeoutPolicy.specialistMode,
    hostTimeoutMs: timeoutPolicy.hostTimeoutMs,
    passTimeoutMs: timeoutPolicy.passTimeoutMs,
    impactPromptBytes: Buffer.byteLength(formatReviewImpactContext(impact)),
    staticReviewCriteriaBytes: Buffer.byteLength(
      `${readReviewAsset('shared-rubric.md')}\n${readReviewAsset('checklist.md')}`,
    ),
    ...impactTelemetry(impact),
  };
  const dir = join(stateRoot(ctx.options), 'workflow-runs', 'telemetry');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${ctx.runId}-review-prompt.json`);
  writeFileSync(file, `${JSON.stringify(telemetry, null, 2)}\n`);
}

function recordReviewHostUsage(
  ctx: WorkflowContext,
  host: string,
  usage?: HostUsage,
): void {
  const dir = join(stateRoot(ctx.options), 'workflow-runs', 'telemetry');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${ctx.runId}-review-host-usage.json`);
  writeFileSync(
    file,
    `${JSON.stringify({ host, available: Boolean(usage), ...usage }, null, 2)}\n`,
  );
}

function readReviewAsset(name: string): string {
  return readFileSync(workflowAssetPath(`review/${name}`), 'utf8');
}

export function changedFilesFromPatch(diff: string): string[] {
  const files: string[] = [];
  let oldPath: string | undefined;
  for (const line of diff.split('\n')) {
    if (line.startsWith('--- ')) {
      oldPath = patchHeaderPath(line.slice(4));
      continue;
    }
    if (!line.startsWith('+++ ')) continue;
    const newPath = patchHeaderPath(line.slice(4));
    const file = newPath ?? oldPath;
    if (file) files.push(file);
    oldPath = undefined;
  }
  return normalizedChangedFiles(files);
}

function patchHeaderPath(raw: string): string | undefined {
  const token = raw.startsWith('"')
    ? decodeGitQuotedPath(raw)
    : raw.split('\t', 1)[0];
  if (!token || token === '/dev/null') return undefined;
  if (token.startsWith('a/') || token.startsWith('b/')) return token.slice(2);
  return token;
}

function decodeGitQuotedPath(raw: string): string {
  const bytes: number[] = [];
  for (let index = 1; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === '"') break;
    if (char !== '\\') {
      bytes.push(...Buffer.from(char));
      continue;
    }
    const escape = raw[++index];
    if (escape === undefined) break;
    const simple = new Map<string, number>([
      ['a', 0x07], ['b', 0x08], ['t', 0x09], ['n', 0x0a],
      ['v', 0x0b], ['f', 0x0c], ['r', 0x0d], ['\\', 0x5c], ['"', 0x22],
    ]);
    const decoded = simple.get(escape);
    if (decoded !== undefined) {
      bytes.push(decoded);
      continue;
    }
    if (/[0-7]/.test(escape)) {
      let octal = escape;
      while (octal.length < 3 && /[0-7]/.test(raw[index + 1] ?? '')) {
        octal += raw[++index];
      }
      bytes.push(Number.parseInt(octal, 8));
      continue;
    }
    bytes.push(...Buffer.from(escape));
  }
  return Buffer.from(bytes).toString('utf8');
}

function normalizedChangedFiles(files: string[]): string[] {
  return [...new Set(files.map((file) => file.replaceAll('\\', '/')).filter(Boolean))].sort();
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
  return `${ctx.runId}-${name}.md`;
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
