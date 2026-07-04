#!/usr/bin/env bun
import { getWorkflow } from './registry';
import { runWorkflow } from './runtime';
import type { WorkflowRunOptions } from './types';

async function main() {
  const { workflowName, options } = parseArgs(process.argv.slice(2));
  const workflow = getWorkflow(workflowName);
  const result = await runWorkflow(workflow, options);
  console.log(JSON.stringify(result, null, 2));
}

function parseArgs(args: string[]): { workflowName: string; options: WorkflowRunOptions } {
  const workflowName = args.shift();
  if (!workflowName || workflowName === '-h' || workflowName === '--help') {
    usage();
    process.exit(workflowName ? 0 : 2);
  }

  const options: WorkflowRunOptions = {};
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
    else usageError(`unknown argument: ${arg}`);
  }
  validateOptions(options);

  return { workflowName, options };
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
}

function takeValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) usageError(`${flag} requires a value`);
  return value;
}

function usageError(message: string): never {
  console.error(message);
  usage();
  process.exit(2);
}

function usage(): void {
  console.error('Usage: bun run workflows/run.ts <workflow-name> [--input <file>] [--base <ref>] [--mode mock|real] [--host mock|claude|codex] [--staged|--worktree|--include-untracked|--diff-file <file>]');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
