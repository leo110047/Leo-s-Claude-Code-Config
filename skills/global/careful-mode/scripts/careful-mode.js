#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function resolveHookModule(relativePath) {
  const candidate = path.resolve(
    __dirname,
    '../../../../hooks/scripts/lib/hook-router',
    relativePath,
  );
  if (fs.existsSync(candidate)) {
    return require(candidate);
  }

  throw new Error(
    `Unable to locate ${relativePath}. Install goldband hooks or run from the repo root.`,
  );
}

const { runModeCli } = resolveHookModule('mode-cli.js');
const { CAREFUL_MODE_GUARDS } = resolveHookModule('careful-mode-rules.js');

try {
  runModeCli({
    argv: process.argv,
    modeName: 'careful-mode',
    displayName: 'Careful Mode',
    protections: CAREFUL_MODE_GUARDS,
    source: 'skills/global/careful-mode/scripts/careful-mode.js',
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[careful-mode] ${message}`);
  process.exit(1);
}
