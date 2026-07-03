import fs from 'node:fs';
import path from 'node:path';
import {
  installCodexRequirements,
  removeCodexRequirements,
  removeManagedClaudeGuidance,
} from './goldband-windows-codex.mjs';
import { readWindowsState, removePath } from './goldband-windows-core.mjs';
import {
  removeHooksConfig,
  removeWindowsLauncherWrappers,
  runWorkflowHelper,
  writeWindowsLauncherWrappers,
} from './goldband-windows-hooks.mjs';
import {
  installClaudeGuidance,
  installCodexAgents,
  installCodexConfig,
  installCodexHooks,
  installCodexRules,
  installCodexSkills,
  installCommands,
  installHooks,
  installRules,
  installSkills,
  installUnity,
} from './goldband-windows-install.mjs';
import { cleanupManagedEntries } from './goldband-windows-profiles.mjs';
import { showWindowsStatus } from './goldband-windows-status.mjs';

function installForWindows(context, actions) {
  for (const action of actions) {
    const handler = actionHandlers[action];
    if (!handler) throw new Error(`unsupported action: ${action}`);
    handler(context);
  }
}

const actionHandlers = {
  'pack-core': installPackCore,
  'pack-quality': installPackQuality,
  all: installPackQuality,
  'all-full': installAllFull,
  skills: (context) => installSkills(context, 'full'),
  'skills-full': (context) => installSkills(context, 'full'),
  'skills-core': (context) => installSkills(context, 'core'),
  'skills-dev': (context) => installSkills(context, 'dev'),
  'claude-guidance': installClaudeGuidance,
  commands: installCommands,
  rules: installRules,
  hooks: installHooks,
  launchers: writeWindowsLauncherWrappers,
  'codex-config': installCodexConfig,
  'codex-requirements': installCodexRequirements,
  'codex-agents': installCodexAgents,
  'codex-hooks': installCodexHooks,
  'codex-rules': installCodexRules,
  'codex-skills': (context) => installCodexSkills(context, 'full'),
  'codex-core': installCodexCore,
  'codex-full': installCodexFull,
  codex: installCodexFull,
  'all-tools': installAllTools,
  workflow: (context) => runWorkflowHelper(context, 'claude'),
  'workflow-codex': (context) => runWorkflowHelper(context, 'codex'),
  'workflow-auto': (context) => runWorkflowHelper(context, 'auto'),
  'all-with-workflow': installAllWithWorkflow,
  status: showWindowsStatus,
  uninstall: uninstallWindows,
  unity: installUnityPack,
  'pack-unity': installUnityPack,
  help: printHelp,
  '-h': printHelp,
  '--help': printHelp,
};

function installPackCore(context) {
  installSkills(context, 'core');
  installClaudeGuidance(context);
  installRules(context);
  installHooks(context);
  writeWindowsLauncherWrappers(context);
}

function installPackQuality(context) {
  installClaudePack(context, 'dev');
}

function installAllFull(context) {
  installClaudePack(context, 'full');
}

function installClaudePack(context, profile) {
  installSkills(context, profile);
  installClaudeGuidance(context);
  installCommands(context);
  installRules(context);
  installHooks(context);
  writeWindowsLauncherWrappers(context);
}

function installCodexCore(context) {
  installCodexPack(context, 'core');
}

function installCodexFull(context) {
  installCodexPack(context, 'full');
}

function installCodexPack(context, profile) {
  installCodexConfig(context);
  installCodexAgents(context);
  installCodexHooks(context);
  installCodexRules(context);
  installCodexSkills(context, profile);
  writeWindowsLauncherWrappers(context);
}

function installAllTools(context) {
  installClaudePack(context, 'full');
  installCodexConfig(context);
  installCodexAgents(context);
  installCodexHooks(context);
  installCodexRules(context);
  installCodexSkills(context, 'full');
}

function installAllWithWorkflow(context) {
  installAllTools(context);
  runWorkflowHelper(context, 'auto');
}

function installUnityPack(context) {
  installPackQuality(context);
  installUnity(context);
}

function uninstallWindows(context) {
  const state = readWindowsState(context);
  cleanupManagedEntries(
    context.paths.skillsDir,
    context.paths.skillProfileFile,
    ['README.md', 'skill-rules.json'],
  );
  cleanupManagedEntries(
    context.paths.agentsSkillsDir,
    context.paths.codexSkillProfileFile,
    [],
  );
  for (const targetPath of uninstallComponentPaths(context)) {
    removePath(targetPath);
  }
  removeManagedClaudeGuidance(context, state);
  removeCodexRequirements(context);
  removeHooksConfig(context);
  removeWindowsLauncherWrappers(context);
  removePath(context.paths.windowsStateFile);
}

function uninstallComponentPaths(context) {
  return [
    path.join(context.paths.claudeDir, 'commands'),
    path.join(context.paths.claudeDir, 'rules'),
    path.join(context.paths.claudeDir, 'hooks'),
    path.join(context.paths.claudeDir, 'statusline-command.sh'),
    context.paths.codexConfigFile,
    ...codexProfilePaths(context),
    context.paths.codexAgentsFile,
    context.paths.codexCustomAgentsDir,
    context.paths.codexHooksFile,
    context.paths.codexHooksDir,
    context.paths.codexRulesDir,
  ];
}

function codexProfilePaths(context) {
  const codexProfileDir = path.join(context.repoDir, 'codex', 'profiles');
  if (!fs.existsSync(codexProfileDir)) return [];
  return fs
    .readdirSync(codexProfileDir)
    .filter((name) => name.endsWith('.config.toml'))
    .map((name) => path.join(context.paths.codexDir, name));
}

function printHelp() {
  console.log(
    'Usage: node scripts/goldband-windows.mjs <command> [actions...] [--home PATH] [--platform win32]',
  );
  console.log('');
  console.log('Commands:');
  console.log('  install <actions...>   Run Windows/native install actions');
  console.log(
    '  sync-skills            Reconcile managed Claude/Codex skill profiles from repo catalog',
  );
  console.log(
    '  self-update            Sync managed skills, then fast-forward goldband when safe',
  );
  console.log('  status                 Show Windows install status');
  console.log(
    '  uninstall              Remove Windows install artifacts managed by this script',
  );
}

export { installForWindows, printHelp, uninstallWindows };
