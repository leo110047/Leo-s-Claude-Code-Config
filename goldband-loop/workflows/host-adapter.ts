import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractNameAndDescription } from '../scripts/resolvers/codex-helpers';
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
  runJson(prompt: string, schema: unknown): Promise<HostResult>;
};

const READ_ONLY_PARALLEL_CAPABILITIES = {
  readOnlyEnforced: true,
  parallelDispatch: true,
};

export class MockHostAdapter implements HostAdapter {
  name = 'mock' as const;
  capabilities = READ_ONLY_PARALLEL_CAPABILITIES;

  async runJson(prompt = ''): Promise<HostResult> {
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

  async runJson(prompt: string, schema: unknown): Promise<HostResult> {
    const dir = mkdtempSync(join(tmpdir(), 'goldband-codex-'));
    const schemaFile = join(dir, 'schema.json');
    const outputFile = join(dir, 'last-message.json');
    writeFileSync(schemaFile, JSON.stringify(schema));
    try {
      const result = await runProcess('codex', codexRunJsonArgs(prompt, schemaFile, outputFile), 120000);
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

  async runJson(prompt: string, schema: unknown): Promise<HostResult> {
    const result = await runProcess('claude', claudeRunJsonArgs(prompt, schema), 120000);
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
    '',
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
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (status: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve({ status, stdout, stderr });
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      stderr += `\n${command} timed out after ${timeoutMs}ms`;
      killTimer = setTimeout(() => {
        stderr += `\n${command} killed after failing to exit on SIGTERM`;
        child.kill('SIGKILL');
        finish(null);
      }, killGraceMs);
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      stderr = stderr || error.message;
      finish(1);
    });
    child.on('close', (status) => {
      finish(status);
    });
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
