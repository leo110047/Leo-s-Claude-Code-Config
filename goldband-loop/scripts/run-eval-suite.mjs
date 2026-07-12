#!/usr/bin/env node

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { superviseCommand } from './process-supervisor.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TEST_DIR = join(ROOT, 'test');
const DEFAULT_TIMEOUT_MS = 55 * 60 * 1_000;

const suite = process.argv[2];
const config = suiteConfig(suite);
const concurrency = positiveEnvInteger('EVALS_CONCURRENCY', 15);
const timeoutMs = positiveEnvInteger(
  'GOLDBAND_EVAL_SUITE_TIMEOUT_MS',
  DEFAULT_TIMEOUT_MS,
);
const files = testFiles(config);
const env = {
  ...process.env,
  EVALS: '1',
  ...(config.all ? { EVALS_ALL: '1' } : {}),
  ...(config.tier ? { EVALS_TIER: config.tier } : {}),
};

const result = await superviseCommand(
  'bun',
  [
    'test',
    '--retry',
    '2',
    '--concurrent',
    '--max-concurrency',
    String(concurrency),
    ...files,
  ],
  {
    cwd: ROOT,
    env,
    timeoutMs,
    completionPattern: /Ran \d+ tests? across \d+ files?\./,
  },
);

process.exitCode = result.exitCode;

function suiteConfig(name) {
  const e2eSurfaces = {
    includeE2e: true,
    includeRouting: true,
    includeCodex: true,
    includeGemini: true,
  };
  const llmAndE2e = { includeLlm: true, ...e2eSurfaces };
  const suites = {
    evals: llmAndE2e,
    'evals-all': { ...llmAndE2e, all: true },
    e2e: e2eSurfaces,
    'e2e-all': { ...e2eSurfaces, all: true },
    gate: { ...llmAndE2e, tier: 'gate' },
    periodic: { ...e2eSurfaces, tier: 'periodic', all: true },
    codex: { includeCodex: true },
    'codex-all': { includeCodex: true, all: true },
    gemini: { includeGemini: true },
    'gemini-all': { includeGemini: true, all: true },
  };
  const selected = suites[name];
  if (!selected) {
    process.stderr.write(
      `Usage: node scripts/run-eval-suite.mjs ${Object.keys(suites).join('|')}\n`,
    );
    process.exit(2);
  }
  return selected;
}

function testFiles(config) {
  const files = [];
  if (config.includeLlm) files.push('test/skill-llm-eval.test.ts');
  if (config.includeE2e) {
    files.push(
      ...readdirSync(TEST_DIR)
        .filter(
          (file) => file.startsWith('skill-e2e-') && file.endsWith('.test.ts'),
        )
        .sort()
        .map((file) => `test/${file}`),
    );
  }
  if (config.includeRouting) files.push('test/skill-routing-e2e.test.ts');
  if (config.includeCodex) files.push('test/codex-e2e.test.ts');
  if (config.includeGemini) files.push('test/gemini-e2e.test.ts');
  return files;
}

function positiveEnvInteger(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0 || String(value) !== raw.trim()) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}
