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

const { runModeCli } = resolveHookModule('mode-cli.js');
const { FREEZE_MODE_PROTECTIONS } = resolveHookModule('freeze-mode-rules.js');

try {
  runModeCli({
    argv: process.argv,
    modeName: 'freeze-mode',
    displayName: 'Freeze Mode',
    protections: FREEZE_MODE_PROTECTIONS,
    source: 'skills/global/freeze-mode/scripts/freeze-mode.js'
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[freeze-mode] ${message}`);
  process.exit(1);
}
