#!/usr/bin/env node

import {
  installForWindows,
  printHelp,
  uninstallWindows,
} from './goldband-windows-actions.mjs';
import { createContext, parseArgs } from './goldband-windows-core.mjs';
import { selfUpdate, syncSkills } from './goldband-windows-runtime.mjs';
import { showWindowsStatus } from './goldband-windows-status.mjs';

function main() {
  const { positional, options } = parseArgs(process.argv.slice(2));
  const command = positional[0] ?? 'help';
  const context = createContext(options);

  if (command === 'install') {
    const actions = positional.slice(1);
    installForWindows(context, actions.length > 0 ? actions : ['all-tools']);
    return;
  }
  if (command === 'sync-skills') {
    syncSkills(context);
    return;
  }
  if (command === 'self-update') {
    selfUpdate(context);
    return;
  }
  if (command === 'status') {
    showWindowsStatus(context);
    return;
  }
  if (command === 'uninstall') {
    uninstallWindows(context);
    return;
  }
  printHelp();
}

main();
