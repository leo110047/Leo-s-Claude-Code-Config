import { spawnSync } from 'node:child_process';
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
  runJson(prompt: string, schema: unknown): Promise<HostResult>;
};

export class MockHostAdapter implements HostAdapter {
  name = 'mock' as const;

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

  async runJson(prompt: string, schema: unknown): Promise<HostResult> {
    const dir = mkdtempSync(join(tmpdir(), 'goldband-codex-'));
    const schemaFile = join(dir, 'schema.json');
    const outputFile = join(dir, 'last-message.json');
    writeFileSync(schemaFile, JSON.stringify(schema));
    try {
      const result = spawnSync('codex', [
        'exec',
        '--sandbox',
        'read-only',
        '--json',
        '--output-schema',
        schemaFile,
        '-o',
        outputFile,
        prompt,
      ], { encoding: 'utf8', timeout: 120000 });
      if (result.status !== 0) throw new Error(result.stderr || result.stdout);
      return readStructuredResult(result.stdout, outputFile);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

export class ClaudeHostAdapter implements HostAdapter {
  name = 'claude' as const;

  async runJson(prompt: string, schema: unknown): Promise<HostResult> {
    const result = spawnSync('claude', [
      '-p',
      '--output-format',
      'json',
      '--disable-slash-commands',
      '--tools',
      '',
      '--max-budget-usd',
      '0.50',
      '--json-schema',
      JSON.stringify(schema),
      prompt,
    ], { encoding: 'utf8', timeout: 120000 });
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
