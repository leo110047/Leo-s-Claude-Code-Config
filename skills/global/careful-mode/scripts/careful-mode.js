#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function resolveHookModule(relativePath) {
  const candidate = path.resolve(__dirname, '../../../../hooks/scripts/lib/hook-router', relativePath);
  if (fs.existsSync(candidate)) {
    return require(candidate);
  }

  throw new Error(`Unable to locate ${relativePath}. Install goldband hooks or run from the repo root.`);
}

const {
  normalizeSessionId,
  readModeState,
  setModeActive,
  getActiveModes
} = resolveHookModule('mode-state.js');
const { CAREFUL_MODE_GUARDS } = resolveHookModule('careful-mode-rules.js');

function parseArgs(argv) {
  const options = {
    action: 'status',
    sessionId: process.env.CLAUDE_SESSION_ID || 'default',
    json: false
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--session') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('Missing value for --session');
      }
      options.sessionId = next;
      index += 1;
      continue;
    }

    if (token === '--json') {
      options.json = true;
      continue;
    }

    if (!token.startsWith('-') && options.action === 'status') {
      options.action = token;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return options;
}

function buildSummary(action, sessionId) {
  const state = readModeState(sessionId);
  const activeModes = getActiveModes(sessionId);
  const carefulModeState = state.modes['careful-mode'] && typeof state.modes['careful-mode'] === 'object'
    ? state.modes['careful-mode']
    : null;

  return {
    action,
    sessionId: state.sessionId,
    active: Boolean(carefulModeState && carefulModeState.active),
    activeModes,
    storageSource: state.storageSource,
    stateFile: state.filePath,
    updatedAt: carefulModeState ? carefulModeState.updatedAt || state.updatedAt : state.updatedAt,
    guardedOperations: CAREFUL_MODE_GUARDS.map(rule => ({
      rule: rule.rule,
      detail: rule.detail
    }))
  };
}

function printHuman(summary) {
  console.log(`Careful Mode: ${summary.active ? 'ENABLED' : 'DISABLED'}`);
  console.log(`Session: ${summary.sessionId}`);
  console.log(`Storage: ${summary.storageSource}`);
  console.log(`State File: ${summary.stateFile}`);
  if (summary.updatedAt) {
    console.log(`Updated At: ${summary.updatedAt}`);
  }

  console.log('');
  console.log('Guarded Operations:');
  for (const guard of summary.guardedOperations) {
    console.log(`- ${guard.detail}`);
  }

  console.log('');
  console.log('Usage: node scripts/careful-mode.js <enable|disable|status> [--session <id>] [--json]');
}

function applyAction(options) {
  const sessionId = normalizeSessionId(options.sessionId);
  const actor = 'careful-mode-script';

  if (options.action === 'enable') {
    setModeActive(sessionId, 'careful-mode', true, { updatedBy: actor });
    return buildSummary('enable', sessionId);
  }

  if (options.action === 'disable') {
    setModeActive(sessionId, 'careful-mode', false, { updatedBy: actor });
    return buildSummary('disable', sessionId);
  }

  if (options.action === 'status') {
    return buildSummary('status', sessionId);
  }

  throw new Error(`Unknown action: ${options.action}`);
}

function main() {
  const options = parseArgs(process.argv);
  const summary = applyAction(options);

  if (options.json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    return;
  }

  printHuman(summary);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[careful-mode] ${message}`);
  process.exit(1);
}
