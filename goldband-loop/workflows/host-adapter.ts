import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractNameAndDescription } from '../scripts/resolvers/codex-helpers';
import { superviseCommand } from '../scripts/process-supervisor.mjs';
import type { ReviewFinding } from './types';

export type HostResult = {
  text: string;
  parsed?: unknown;
};

export type HostAdapter = {
  name: 'mock' | 'claude' | 'codex';
  capabilities: {
    readOnlyEnforced: boolean;
    parallelDispatch: boolean;
  };
  runJson(prompt: string, schema: unknown, cwd: string): Promise<HostResult>;
};

const READ_ONLY_PARALLEL_CAPABILITIES = {
  readOnlyEnforced: true,
  parallelDispatch: true,
};

export class MockHostAdapter implements HostAdapter {
  name = 'mock' as const;
  capabilities = READ_ONLY_PARALLEL_CAPABILITIES;

  async runJson(prompt = '', _schema?: unknown, _cwd?: string): Promise<HostResult> {
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
      recommendation: 'Add a guard and a focused regression test.',
  };
}

export class CodexHostAdapter implements HostAdapter {
  name = 'codex' as const;
  capabilities = READ_ONLY_PARALLEL_CAPABILITIES;

  async runJson(prompt: string, schema: unknown, cwd: string): Promise<HostResult> {
    const dir = mkdtempSync(join(tmpdir(), 'goldband-codex-'));
    const schemaFile = join(dir, 'schema.json');
    const outputFile = join(dir, 'last-message.json');
    writeFileSync(schemaFile, JSON.stringify(schema));
    try {
      const result = await runProcess(
        'codex',
        codexRunJsonArgs(prompt, schemaFile, outputFile),
        120000,
        2000,
        cwd,
      );
      if (result.status !== 0) throw new Error(result.stderr || result.stdout);
      return readStructuredResult(result.stdout, outputFile);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

export class ClaudeHostAdapter implements HostAdapter {
  name = 'claude' as const;
  capabilities = READ_ONLY_PARALLEL_CAPABILITIES;

  async runJson(prompt: string, schema: unknown, cwd: string): Promise<HostResult> {
    const result = await runProcess(
      'claude',
      claudeRunJsonArgs(prompt, schema),
      120000,
      2000,
      cwd,
    );
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
    return parseClaudeJson(result.stdout);
  }
}

export function adapterFor(name: string | undefined): HostAdapter {
  if (!name || name === 'mock') return new MockHostAdapter();
  if (name === 'codex') return new CodexHostAdapter();
  if (name === 'claude') return new ClaudeHostAdapter();
  throw new Error(`unsupported workflow host adapter: ${name}`);
}

export function workflowLabelFromTemplate(content: string): string {
  const { name, description } = extractNameAndDescription(content);
  return [name, description.split('\n')[0]].filter(Boolean).join(': ');
}

export function codexRunJsonArgs(prompt: string, schemaFile: string, outputFile: string): string[] {
  return [
    'exec',
    '--sandbox',
    'read-only',
    '--json',
    '--output-schema',
    schemaFile,
    '-o',
    outputFile,
    prompt,
  ];
}

export function claudeRunJsonArgs(prompt: string, schema: unknown): string[] {
  return [
    '-p',
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
    prompt,
  ];
}

export function runProcess(
  command: string,
  args: string[],
  timeoutMs: number,
  killGraceMs = 2000,
  cwd?: string,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return superviseCommand(command, args, {
    cwd,
    timeoutMs,
    killGraceMs,
    captureOutput: true,
    label: 'goldband workflow',
    stdout: { write() {} },
    stderr: { write() {} },
  }).then((result) => {
    let stderr = result.stderr;
    if (result.reason === 'timeout') {
      stderr += `\n${command} timed out after ${timeoutMs}ms`;
      if (result.forceKilled) {
        stderr += `\n${command} killed after failing to exit on SIGTERM`;
      }
    }
    return {
      status:
        result.reason === 'exit' || result.reason === 'spawn-error'
          ? result.exitCode
          : null,
      stdout: result.stdout,
      stderr,
    };
  });
}

function readStructuredResult(stdout: string, outputFile: string): HostResult {
  const text = readFileSync(outputFile, 'utf8').trim() || stdout.trim();
  return { text, parsed: JSON.parse(text) };
}

function parseClaudeJson(stdout: string): HostResult {
  const parsed = JSON.parse(stdout);
  if (typeof parsed.result === 'string') {
    return { text: parsed.result, parsed: JSON.parse(parsed.result) };
  }
  return { text: stdout, parsed };
}
