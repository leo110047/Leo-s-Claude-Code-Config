#!/usr/bin/env bun
import { getWorkflow } from './registry';
import { runWorkflowLoop } from './loop';
import { runWorkflow } from './runtime';
import type { WorkflowRunOptions } from './types';

async function main() {
  const { capability, action, options, loop } = parseArgs(process.argv.slice(2));
  const workflow = getWorkflow(`${capability}/${action}`);
  warnIgnoredOptions(options, loop);
  const result = loop ? await runWorkflowLoop(workflow, options) : await runWorkflow(workflow, options);
  console.log(JSON.stringify(result, null, 2));
}

function parseArgs(args: string[]): { capability: string; action: string; options: WorkflowRunOptions; loop: boolean } {
  const capability = args.shift();
  if (!capability || capability === '-h' || capability === '--help') {
    usage();
    process.exit(capability ? 0 : 2);
  }
  const action = args.shift();
  if (!action || action.startsWith('-')) usageError('both <capability> and <action> are required; legacy workflow names are not supported');

  const options: WorkflowRunOptions = {};
  let loop = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--input') options.inputFile = takeValue(args, ++index, arg);
    else if (arg === '--base') options.base = takeValue(args, ++index, arg);
    else if (arg === '--mode') options.mode = takeValue(args, ++index, arg) as WorkflowRunOptions['mode'];
    else if (arg === '--host') options.host = takeValue(args, ++index, arg) as WorkflowRunOptions['host'];
    else if (arg === '--diff-file') options.diffFile = takeValue(args, ++index, arg);
    else if (arg === '--staged') options.staged = true;
    else if (arg === '--worktree') options.worktree = true;
    else if (arg === '--include-untracked') options.includeUntracked = true;
    else if (arg === '--specialists') options.specialists = takeValue(args, ++index, arg) as WorkflowRunOptions['specialists'];
    else if (arg === '--loop') loop = true;
    else if (arg === '--max-iterations') options.maxIterations = takeNumber(args, ++index, arg);
    else usageError(`unknown argument: ${arg}`);
  }
  validateOptions(options);

  return { capability, action, options, loop };
}

function validateOptions(options: WorkflowRunOptions): void {
  if (options.mode && !['mock', 'real'].includes(options.mode)) {
    usageError(`invalid --mode: ${options.mode}`);
  }
  if (options.host && !['mock', 'claude', 'codex'].includes(options.host)) {
    usageError(`invalid --host: ${options.host}`);
  }
  if (options.mode === 'real' && (!options.host || options.host === 'mock')) {
    usageError('--mode real requires --host claude or --host codex');
  }
  if (options.host && options.host !== 'mock' && options.mode !== 'real') {
    usageError('--host claude|codex requires --mode real');
  }
  if (options.specialists && !['off', 'auto', 'all'].includes(options.specialists)) {
    usageError(`invalid --specialists: ${options.specialists}`);
  }
}

function warnIgnoredOptions(options: WorkflowRunOptions, loop: boolean): void {
  if (!loop && options.maxIterations !== undefined) {
    console.error('--max-iterations is ignored without --loop');
  }
}

function takeValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) usageError(`${flag} requires a value`);
  return value;
}

function takeNumber(args: string[], index: number, flag: string): number {
  const value = Number.parseInt(takeValue(args, index, flag), 10);
  if (!Number.isInteger(value) || value < 1) usageError(`${flag} requires a positive integer`);
  return value;
}

function usageError(message: string): never {
  console.error(message);
  usage();
  process.exit(2);
}

function usage(): void {
  console.error('Usage: bun run workflows/run.ts <capability> <action> [--loop] [--max-iterations <n>] [--input <file>] [--base <ref>] [--mode mock|real] [--host mock|claude|codex] [--specialists off|auto|all] [--staged|--worktree|--include-untracked|--diff-file <file>]');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
