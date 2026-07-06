#!/usr/bin/env node

import {
  buildSummary,
  classifyTelemetry,
  extractEvalCandidates,
  extractFixtureCandidates,
  printSummaryMarkdown,
} from './lib/telemetry-miner/index.mjs';

const DEFAULT_DAYS = 30;
const DEFAULT_LIMIT = 20;

function parseArgs(argv) {
  const rawArgs = argv.slice(2);
  if (rawArgs[0] === '--help' || rawArgs[0] === '-h') {
    return baseOptions('help');
  }
  const [command = 'summary', ...tokens] = rawArgs;
  const options = baseOptions(command);
  for (let index = 0; index < tokens.length; index += 1) {
    index = consumeArg(options, tokens, index);
  }
  return options;
}

function baseOptions(command) {
  return {
    command,
    days: DEFAULT_DAYS,
    limit: DEFAULT_LIMIT,
    json: false,
    usageFile: null,
    workflowRunsDir: null,
    outDir: null,
  };
}

function consumeArg(options, tokens, index) {
  const token = tokens[index];
  if (token === '--json') options.json = true;
  else if (token === '--days') options.days = positiveInt(tokens[index + 1]);
  else if (token === '--limit') options.limit = positiveInt(tokens[index + 1]);
  else if (token === '--usage-file')
    options.usageFile = value(tokens[index + 1], token);
  else if (token === '--workflow-runs-dir') {
    options.workflowRunsDir = value(tokens[index + 1], token);
  } else if (token === '--out-dir' || token === '--review-dir') {
    options.outDir = value(tokens[index + 1], token);
  } else if (token === '--help' || token === '-h') {
    options.command = 'help';
    return index;
  } else {
    throw new Error(`Unknown option: ${token}`);
  }
  return consumesValue(token) ? index + 1 : index;
}

function consumesValue(token) {
  return [
    '--days',
    '--limit',
    '--usage-file',
    '--workflow-runs-dir',
    '--out-dir',
    '--review-dir',
  ].includes(token);
}

function positiveInt(raw) {
  const parsed = Number.parseInt(String(raw || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Expected a positive integer');
  }
  return parsed;
}

function value(raw, flag) {
  if (!raw) throw new Error(`${flag} requires a value`);
  return raw;
}

function usage() {
  return `Usage: node scripts/mine-telemetry.mjs <summary|classify|extract-fixtures|extract-evals> [options]

Options:
  --json                         Print machine-readable JSON for summary.
  --days <n>                     Look back n days. Default: ${DEFAULT_DAYS}.
  --limit <n>                    Limit rows or candidates. Default: ${DEFAULT_LIMIT}.
  --usage-file <path>            Usage JSONL base file. Rotated siblings are included.
  --workflow-runs-dir <path>     Workflow evidence directory.
  --out-dir <path>               Candidate review output directory.
`;
}

function run(options) {
  if (options.command === 'help') return usage();
  if (options.command === 'summary') return runSummary(options);
  if (options.command === 'classify') {
    return `${JSON.stringify(classifyTelemetry(options), null, 2)}\n`;
  }
  if (options.command === 'extract-fixtures') {
    return `${JSON.stringify(extractFixtureCandidates(options), null, 2)}\n`;
  }
  if (options.command === 'extract-evals') {
    return `${JSON.stringify(extractEvalCandidates(options), null, 2)}\n`;
  }
  throw new Error(`Unknown command: ${options.command}`);
}

function runSummary(options) {
  const summary = buildSummary(options);
  if (options.json) return `${JSON.stringify(summary, null, 2)}\n`;
  return printSummaryMarkdown(summary);
}

function runCli() {
  try {
    process.stdout.write(run(parseArgs(process.argv)));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) runCli();

export { parseArgs, run };
