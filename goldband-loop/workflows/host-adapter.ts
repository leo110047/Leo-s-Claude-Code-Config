import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { superviseCommand } from '../scripts/process-supervisor.mjs';
import type { ReviewFinding } from './types';

type HostResult = {
  text: string;
  parsed?: unknown;
  usage?: HostUsage;
};

export type HostUsage = {
  source: 'codex-jsonl' | 'claude-json';
  inputTokens?: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  model?: string;
};

type HostRunOptions = {
  timeoutMs: number;
};

export type RunProcessOptions = {
  timeoutMs: number;
  killGraceMs?: number;
  cwd?: string;
  input?: string;
  stdoutMaxBytes: number;
  stderrMaxBytes: number;
};

export type RunProcessResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
};

export const MAX_HOST_DIAGNOSTIC_BYTES = 256 * 1024;
export const MAX_HOST_STRUCTURED_OUTPUT_BYTES = 2 * 1024 * 1024;

export type HostAdapter = {
  name: 'mock' | 'claude' | 'codex';
  capabilities: {
    readOnlyEnforced: boolean;
    parallelDispatch: boolean;
  };
  runJson(
    prompt: string,
    schema: unknown,
    cwd: string,
    options: HostRunOptions,
  ): Promise<HostResult>;
};

const READ_ONLY_SINGLE_REVIEW_CAPABILITIES = {
  readOnlyEnforced: true,
  parallelDispatch: false,
};

class MockHostAdapter implements HostAdapter {
  name = 'mock' as const;
  capabilities = READ_ONLY_SINGLE_REVIEW_CAPABILITIES;

  async runJson(
    prompt = '',
    _schema?: unknown,
    _cwd?: string,
    _options?: HostRunOptions,
  ): Promise<HostResult> {
    const findings = mockFindingsForPrompt(prompt);
    const parsed = { findings };
    return { text: JSON.stringify(parsed), parsed };
  }
}

function mockFindingsForPrompt(prompt: string): ReviewFinding[] {
  void prompt;
  return [mockFinding(1)];
}

function mockFinding(index: number): ReviewFinding {
  return {
    file: 'src/example.ts',
    line: index + 1,
    severity: 'medium',
    summary: `Mock review finding ${index} with concrete diff evidence.`,
    evidence: '+ riskyChange();',
    failureScenario: 'A valid request reaches riskyChange() and returns the wrong result.',
    recommendation: 'Add a guard and a focused regression test.',
    suggestedVerification: 'Run the focused mock review regression test.',
  };
}

class CodexHostAdapter implements HostAdapter {
  name = 'codex' as const;
  capabilities = READ_ONLY_SINGLE_REVIEW_CAPABILITIES;

  async runJson(
    prompt: string,
    schema: unknown,
    cwd: string,
    options: HostRunOptions,
  ): Promise<HostResult> {
    const dir = mkdtempSync(join(tmpdir(), 'goldband-codex-'));
    const schemaFile = join(dir, 'schema.json');
    const outputFile = join(dir, 'last-message.json');
    writeFileSync(schemaFile, JSON.stringify(schema));
    try {
      const result = await runProcess(
        process.env.GOLDBAND_TRUSTED_CODEX_EXECUTABLE || 'codex',
        codexRunJsonArgs(schemaFile, outputFile),
        {
          timeoutMs: options.timeoutMs,
          killGraceMs: 2000,
          cwd,
          input: prompt,
          stdoutMaxBytes: MAX_HOST_DIAGNOSTIC_BYTES,
          stderrMaxBytes: MAX_HOST_DIAGNOSTIC_BYTES,
        },
      );
      if (result.status !== 0) throw new Error(processFailureMessage(result));
      return readStructuredResult(outputFile, parseCodexUsage(result.stdout));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

class ClaudeHostAdapter implements HostAdapter {
  name = 'claude' as const;
  capabilities = READ_ONLY_SINGLE_REVIEW_CAPABILITIES;

  async runJson(
    prompt: string,
    schema: unknown,
    cwd: string,
    options: HostRunOptions,
  ): Promise<HostResult> {
    const result = await runProcess(
      'claude',
      claudeRunJsonArgs(schema),
      {
        timeoutMs: options.timeoutMs,
        killGraceMs: 2000,
        cwd,
        input: prompt,
        stdoutMaxBytes: MAX_HOST_STRUCTURED_OUTPUT_BYTES,
        stderrMaxBytes: MAX_HOST_DIAGNOSTIC_BYTES,
      },
    );
    if (result.status !== 0) throw new Error(processFailureMessage(result));
    if (result.stdoutTruncated) {
      throw new Error(
        `claude structured output exceeds ${MAX_HOST_STRUCTURED_OUTPUT_BYTES} byte limit`,
      );
    }
    return parseClaudeJson(result.stdout);
  }
}

export function adapterFor(name: string | undefined): HostAdapter {
  if (!name || name === 'mock') return new MockHostAdapter();
  if (name === 'codex') return new CodexHostAdapter();
  if (name === 'claude') return new ClaudeHostAdapter();
  throw new Error(`unsupported workflow host adapter: ${name}`);
}


export function codexRunJsonArgs(schemaFile: string, outputFile: string): string[] {
  return [
    '-c',
    'mcp_servers={}',
    '--ask-for-approval',
    'never',
    'exec',
    '--ignore-user-config',
    '--ephemeral',
    '--sandbox',
    'read-only',
    '--json',
    '--output-schema',
    schemaFile,
    '-o',
    outputFile,
    '-',
  ];
}

export function claudeRunJsonArgs(schema: unknown): string[] {
  return [
    '-p',
    '--safe-mode',
    '--output-format',
    'json',
    '--disable-slash-commands',
    '--tools',
    'Read,Glob,Grep',
    '--disallowedTools',
    'Bash,Edit,Write',
    '--max-budget-usd',
    '0.50',
    '--json-schema',
    JSON.stringify(schema),
  ];
}

export function runProcess(
  command: string,
  args: string[],
  options: RunProcessOptions,
): Promise<RunProcessResult> {
  return superviseCommand(command, args, {
    cwd: options.cwd,
    timeoutMs: options.timeoutMs,
    killGraceMs: options.killGraceMs ?? 2000,
    captureOutput: {
      stdoutMaxBytes: options.stdoutMaxBytes,
      stderrMaxBytes: options.stderrMaxBytes,
    },
    label: 'goldband workflow',
    stdout: { write() {} },
    stderr: { write() {} },
    input: options.input,
  }).then((result) => {
    let stderr = result.stderr;
    let stderrTruncated = result.stderrTruncated;
    if (result.reason === 'timeout') {
      stderr += `\n${command} timed out after ${options.timeoutMs}ms`;
      if (result.forceKilled) {
        stderr += `\n${command} killed after failing to exit on SIGTERM`;
      }
      const bounded = boundedUtf8Tail(stderr, options.stderrMaxBytes);
      stderr = bounded.text;
      stderrTruncated = stderrTruncated || bounded.truncated;
    }
    return {
      status:
        result.reason === 'exit' || result.reason === 'spawn-error'
          ? result.exitCode
          : null,
      stdout: result.stdout,
      stderr,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated,
    };
  });
}

function boundedUtf8Tail(
  value: string,
  maxBytes: number,
): { text: string; truncated: boolean } {
  const buffer = Buffer.from(value);
  if (buffer.length <= maxBytes) return { text: value, truncated: false };
  let start = buffer.length - maxBytes;
  while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) start += 1;
  return { text: buffer.subarray(start).toString('utf8'), truncated: true };
}

function readStructuredResult(
  outputFile: string,
  usage?: HostUsage,
): HostResult {
  const size = statSync(outputFile).size;
  if (size > MAX_HOST_STRUCTURED_OUTPUT_BYTES) {
    throw new Error(
      `codex structured output exceeds ${MAX_HOST_STRUCTURED_OUTPUT_BYTES} byte limit`,
    );
  }
  const text = readFileSync(outputFile, 'utf8').trim();
  if (!text) throw new Error('codex structured output file is empty');
  return { text, parsed: JSON.parse(text), usage };
}

function processFailureMessage(result: RunProcessResult): string {
  const message = result.stderr || result.stdout || 'review host process failed';
  const truncated = [
    result.stderrTruncated ? 'stderr' : '',
    result.stdoutTruncated ? 'stdout' : '',
  ].filter(Boolean);
  return truncated.length > 0
    ? `${message}\n[goldband workflow] ${truncated.join(' and ')} diagnostics truncated to bounded tail`
    : message;
}

export function parseClaudeJson(stdout: string): HostResult {
  const parsed = JSON.parse(stdout);
  const parsedRecord = recordValue(parsed) ?? {};
  const baseUsage = usageFromCandidate(
    parsedRecord.usage,
    'claude-json',
    parsedRecord.model,
  );
  const usage = baseUsage
    ? {
        ...baseUsage,
        costUsd: baseUsage.costUsd ?? numericValue(
          parsedRecord,
          'total_cost_usd',
          'cost_usd',
          'costUsd',
        ),
      }
    : undefined;
  if (typeof parsed.result === 'string') {
    return { text: parsed.result, parsed: JSON.parse(parsed.result), usage };
  }
  return { text: stdout, parsed, usage };
}

export function parseCodexUsage(stdout: string): HostUsage | undefined {
  const lines = stdout.split('\n').filter(Boolean).reverse();
  for (const line of lines) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!event || typeof event !== 'object') continue;
    const item = event as Record<string, unknown>;
    const candidates = [
      item.usage,
      recordValue(item.data)?.usage,
      recordValue(item.turn)?.usage,
    ];
    for (const candidate of candidates) {
      const usage = usageFromCandidate(candidate, 'codex-jsonl', item.model);
      if (usage) return usage;
    }
  }
  return undefined;
}

function usageFromCandidate(
  candidate: unknown,
  source: HostUsage['source'],
  modelCandidate?: unknown,
): HostUsage | undefined {
  const usage = recordValue(candidate);
  if (!usage) return undefined;
  const result: HostUsage = {
    source,
    inputTokens: numericValue(usage, 'input_tokens', 'inputTokens'),
    cachedInputTokens: numericValue(
      usage,
      'cached_input_tokens',
      'cachedInputTokens',
      'cache_read_input_tokens',
    ),
    cacheCreationInputTokens: numericValue(
      usage,
      'cache_creation_input_tokens',
      'cacheCreationInputTokens',
    ),
    outputTokens: numericValue(usage, 'output_tokens', 'outputTokens'),
    totalTokens: numericValue(usage, 'total_tokens', 'totalTokens'),
    costUsd: numericValue(usage, 'total_cost_usd', 'cost_usd', 'costUsd'),
    model: typeof modelCandidate === 'string' ? modelCandidate : undefined,
  };
  const hasMeasurement = Object.entries(result)
    .some(([key, value]) => key !== 'source' && value !== undefined);
  return hasMeasurement ? result : undefined;
}

function numericValue(
  value: Record<string, unknown>,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0) {
      return candidate;
    }
  }
  return undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? value as Record<string, unknown>
    : undefined;
}
