import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { adapterFor, workflowLabelFromTemplate } from './host-adapter';
import { evidencePath, stateRoot } from './evidence';
import { findingsSchema, normalizeFindings, textSchema, type ReviewFinding } from './schema';
import type { WorkflowContext, WorkflowStep } from './types';

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
  const prompt = buildReviewPrompt(ctx, input.diff);
  const result = await adapter.runJson(prompt, findingsEnvelopeJsonSchema);
  return findingsSchema.validate(unwrapFindings(result.parsed));
}

function parseFindings(ctx: WorkflowContext): ReviewFinding[] {
  return normalizeFindings(findingsSchema.validate(ctx.input));
}

function verifyFindings(ctx: WorkflowContext): ReviewFinding[] {
  return findingsSchema.validate(ctx.input).map((finding) => {
    if (finding.severity !== 'critical' && finding.severity !== 'high') return finding;
    if (finding.evidence) return finding;
    return downgradeUnverifiedFinding(finding);
  });
}

function renderReport(ctx: WorkflowContext): string {
  const findings = findingsSchema.validate(ctx.input);
  const lines = ['# goldband-review runtime report', ''];
  if (findings.length === 0) {
    lines.push('No findings.');
  } else {
    for (const finding of findings) {
      const loc = finding.line ? `${finding.file}:${finding.line}` : finding.file;
      lines.push(`- [${finding.severity}] ${loc} - ${finding.summary}`);
    }
  }
  const report = `${lines.join('\n')}\n`;
  const dir = join(stateRoot(ctx.options), 'workflow-runs', 'artifacts');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${ctx.runId}-${basename(ctx.workflow.name)}.md`);
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
    `+[[goldband-review skipped untracked file: ${reason}]]`,
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

function downgradeUnverifiedFinding(finding: ReviewFinding): ReviewFinding {
  return {
    ...finding,
    severity: 'info',
    summary: `[unverified ${finding.severity}] ${finding.summary}`,
    evidence: 'High-severity finding lacked concrete diff evidence during runtime verification.',
  };
}

function reviewHost(ctx: WorkflowContext): 'mock' | 'claude' | 'codex' {
  if (ctx.options.mode !== 'real') return 'mock';
  if (ctx.options.host === 'claude' || ctx.options.host === 'codex') return ctx.options.host;
  throw new Error('--mode real requires --host claude or --host codex');
}

function buildReviewPrompt(ctx: WorkflowContext, diff: string): string {
  const template = readFileSync(workflowTemplatePath(ctx.workflow.sourceTemplate), 'utf8');
  const label = workflowLabelFromTemplate(template);
  return [
    `${label}`,
    'Return only JSON matching the provided findings schema.',
    'Review this diff for concrete, evidence-backed issues.',
    'DIFF_START',
    diff,
    'DIFF_END',
  ].join('\n');
}

function workflowTemplatePath(sourceTemplate: string): string {
  if (isAbsolute(sourceTemplate)) return sourceTemplate;
  return resolve(import.meta.dir, '..', sourceTemplate);
}

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
    },
    required: ['file', 'line', 'severity', 'summary', 'evidence', 'recommendation'],
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

function unwrapFindings(value: unknown): unknown {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return value;
  return (value as { findings?: unknown }).findings;
}
