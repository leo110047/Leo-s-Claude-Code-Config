#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  listLegacyHostSkillArtifacts,
  minimumBunVersion,
  removeLegacyHostSkillArtifacts,
  versionAtLeast,
} from './lib/repo-test-environment.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const bunCommand = process.platform === 'win32' ? 'bun.exe' : 'bun';

export const BOOTSTRAP_STEPS = [
  {
    label: 'root Node dependencies',
    command: npmCommand,
    args: ['ci'],
    cwd: ROOT,
  },
  {
    label: 'MCP server dependencies',
    command: npmCommand,
    args: ['ci'],
    cwd: path.join(ROOT, 'mcp', 'server'),
  },
  {
    label: 'Goldband Loop dependencies',
    command: bunCommand,
    args: ['install', '--frozen-lockfile'],
    cwd: path.join(ROOT, 'goldband-loop'),
  },
];

export function main(args = process.argv.slice(2)) {
  const dryRun = parseArgs(args);
  assertSupportedBun();
  const artifacts = listLegacyHostSkillArtifacts(ROOT);
  if (dryRun) {
    for (const relativePath of artifacts) {
      console.log(`[bootstrap:test] would remove ${relativePath}`);
    }
  } else {
    const removed = removeLegacyHostSkillArtifacts(ROOT);
    for (const relativePath of removed) {
      console.log(`[bootstrap:test] removed ${relativePath}`);
    }
  }
  for (const step of BOOTSTRAP_STEPS) {
    if (dryRun) {
      console.log(
        `[bootstrap:test] would install ${step.label}: ${step.command} ${step.args.join(' ')}`,
      );
    } else {
      runStep(step);
    }
  }
  if (dryRun) {
    console.log('[bootstrap:test] dry run complete; no files were changed');
    return;
  }
  console.log('[bootstrap:test] repository test environment is ready');
}

function parseArgs(args) {
  if (args.length === 0) return false;
  if (args.length === 1 && args[0] === '--dry-run') return true;
  throw new Error(`unknown argument: ${args.join(' ')}`);
}

function assertSupportedBun() {
  const minimum = minimumBunVersion(ROOT);
  const result = spawnSync(bunCommand, ['--version'], { encoding: 'utf8' });
  const current = result.status === 0 ? result.stdout.trim() : '';
  if (!current || !versionAtLeast(current, minimum)) {
    throw new Error(
      `Bun >=${minimum} is required; found ${current || 'not installed'}`,
    );
  }
}

function runStep(step) {
  console.log(`[bootstrap:test] installing ${step.label}`);
  const result = spawnSync(step.command, step.args, {
    cwd: step.cwd,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(
      `${step.label} install failed with exit code ${result.status ?? 1}`,
    );
  }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) {
  try {
    main();
  } catch (error) {
    console.error(
      `[bootstrap:test] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
