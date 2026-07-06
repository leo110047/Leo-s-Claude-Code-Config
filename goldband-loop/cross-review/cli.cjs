#!/usr/bin/env node

const {
  appendResponse,
  createContract,
  crossReviewDir,
  markDone,
  overrideContract,
  readContract,
  runReviewRound,
} = require('./core.cjs');

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function requireValue(args, key) {
  if (!args[key]) throw new Error(`missing --${key}`);
  return args[key];
}

function printJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function usage() {
  console.log(`Usage:
  goldband-cross-review start --plan <path> [--reviewer <codex|claude>] [--model <model>] [--implementer <claude|codex>] [--session-id <id>]
  goldband-cross-review run [--session-id <id>] [--review-mode mock|real] [--mock-verdict APPROVED|CHANGES_REQUESTED|ESCALATE] [--model <model>]
  goldband-cross-review respond --session-id <id> --finding-id <id> --response fixed|rebutted|ask-human --summary <text> [--evidence <path>]
  goldband-cross-review done --session-id <id>
  goldband-cross-review override --session-id <id> --reason <text>
  goldband-cross-review status --session-id <id>`);
}

function commandStart(args) {
  const contract = createContract({
    sessionId: args['session-id'],
    implementer: args.implementer,
    reviewer: args.reviewer,
    reviewerModel: args.model,
    planFile: requireValue(args, 'plan'),
    maxRounds: args['max-rounds'],
    ttlHours: args['ttl-hours'],
    cwd: process.cwd(),
  });
  printJson({ status: 'armed', contractPath: `${crossReviewDir()}/${contract.sessionId}.json`, contract });
}

function commandRun(args) {
  const result = runReviewRound({
    sessionId: args['session-id'],
    reviewMode: args['review-mode'] || 'real',
    model: args.model,
    mockVerdict: args['mock-verdict'] || 'APPROVED',
    cwd: process.cwd(),
  });
  printJson({ status: statusForReviewArtifact(result.artifact), ...result });
}

function statusForReviewArtifact(artifact) {
  if (artifact.verdict === 'APPROVED') return 'approved-marker-written';
  if (artifact.verdict === 'CHANGES_REQUESTED') return 'changes-requested';
  return 'escalated';
}

function commandRespond(args) {
  const evidence = args.evidence
    ? String(args.evidence)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
  const response = appendResponse(requireValue(args, 'session-id'), {
    findingId: requireValue(args, 'finding-id'),
    response: requireValue(args, 'response'),
    summary: requireValue(args, 'summary'),
    evidence,
  });
  printJson({ status: 'recorded', response });
}

function commandDone(args) {
  const contract = markDone(requireValue(args, 'session-id'), process.cwd());
  printJson({ status: 'done', contract });
}

function commandOverride(args) {
  const contract = overrideContract(requireValue(args, 'session-id'), requireValue(args, 'reason'));
  printJson({ status: 'overridden', contract });
}

function commandStatus(args) {
  const contract = readContract(requireValue(args, 'session-id'));
  printJson({ status: contract ? contract.status : 'not-armed', contract });
}

function main() {
  const args = parseArgs(process.argv);
  const command = args._[0];
  if (!command || command === 'help') {
    usage();
    return;
  }
  if (command === 'start') return commandStart(args);
  if (command === 'run') return commandRun(args);
  if (command === 'respond') return commandRespond(args);
  if (command === 'done') return commandDone(args);
  if (command === 'override') return commandOverride(args);
  if (command === 'status') return commandStatus(args);
  throw new Error(`unknown command: ${command}`);
}

try {
  main();
} catch (error) {
  console.error(`goldband-cross-review: ${error.message}`);
  process.exit(1);
}
