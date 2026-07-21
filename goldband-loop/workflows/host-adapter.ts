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

export type HostResult = {
  text: string;
  parsed?: unknown;
};

export type HostRunOptions = {
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

const READ_ONLY_PARALLEL_CAPABILITIES = {
  readOnlyEnforced: true,
  parallelDispatch: true,
};

export class MockHostAdapter implements HostAdapter {
  name = 'mock' as const;
  capabilities = READ_ONLY_PARALLEL_CAPABILITIES;

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
  const iteration = loopIteration(prompt);
  if (iteration === 1) return [mockFinding(1), mockFinding(2)];
  if (iteration === 2) return [];
  return [mockFinding(1)];
}

function loopIteration(prompt: string): number | undefined {
  const match = prompt.match(/^GOLDBAND_LOOP_ITERATION=(\d+)$/m);
  return match ? Number.parseInt(match[1], 10) : undefined;
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
  capabilities = READ_ONLY_PARALLEL_CAPABILITIES;

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
        'codex',
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
      return readStructuredResult(outputFile);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

class ClaudeHostAdapter implements HostAdapter {
  name = 'claude' as const;
  capabilities = READ_ONLY_PARALLEL_CAPABILITIES;

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

function readStructuredResult(outputFile: string): HostResult {
  const size = statSync(outputFile).size;
  if (size > MAX_HOST_STRUCTURED_OUTPUT_BYTES) {
    throw new Error(
      `codex structured output exceeds ${MAX_HOST_STRUCTURED_OUTPUT_BYTES} byte limit`,
    );
  }
  const text = readFileSync(outputFile, 'utf8').trim();
  if (!text) throw new Error('codex structured output file is empty');
  return { text, parsed: JSON.parse(text) };
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

function parseClaudeJson(stdout: string): HostResult {
  const parsed = JSON.parse(stdout);
  if (typeof parsed.result === 'string') {
    return { text: parsed.result, parsed: JSON.parse(parsed.result) };
  }
  return { text: stdout, parsed };
}
