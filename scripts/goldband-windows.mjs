#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_DIR = path.resolve(__dirname, '..');
const SKILL_CATALOG_FILE = path.join(REPO_DIR, 'shell', 'install', 'skill-catalog.txt');
const HOOKS_CONFIG_FILE = path.join(REPO_DIR, 'hooks', 'hooks.json');
const WINDOWS_STATE_VERSION = 1;

const DEFAULT_COLORS = {
  reset: '\u001b[0m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  blue: '\u001b[34m',
  cyan: '\u001b[36m',
};

function colorize(enabled, color, text) {
  if (!enabled) {
    return text;
  }
  return `${DEFAULT_COLORS[color]}${text}${DEFAULT_COLORS.reset}`;
}

function parseArgs(argv) {
  const positional = [];
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }

    const trimmed = token.slice(2);
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex >= 0) {
      const key = trimmed.slice(0, equalsIndex);
      const value = trimmed.slice(equalsIndex + 1);
      options[key] = value;
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      options[trimmed] = next;
      index += 1;
    } else {
      options[trimmed] = true;
    }
  }

  return { positional, options };
}

function normalizePlatform(rawPlatform) {
  if (!rawPlatform) {
    return process.platform;
  }
  const normalized = String(rawPlatform).trim().toLowerCase();
  if (normalized === 'windows' || normalized === 'win') {
    return 'win32';
  }
  return normalized;
}

function createContext(rawOptions = {}) {
  const effectivePlatform = normalizePlatform(
    rawOptions.platform ?? process.env.GOLDBAND_TEST_PLATFORM ?? process.platform,
  );
  const realWindows = effectivePlatform === 'win32' && process.platform === 'win32';
  const homeDir = path.resolve(
    rawOptions.home ?? process.env.GOLDBAND_TEST_HOME ?? os.homedir(),
  );
  const repoDir = path.resolve(
    rawOptions.repo ?? process.env.GOLDBAND_SELF_UPDATE_REPO_DIR ?? REPO_DIR,
  );

  const claudeDir = path.join(homeDir, '.claude');
  const codexDir = path.join(homeDir, '.codex');
  const agentsDir = path.join(homeDir, '.agents');
  const powershellProfiles = [
    path.join(homeDir, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1'),
    path.join(homeDir, 'Documents', 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1'),
  ];

  return {
    platform: effectivePlatform,
    realWindows,
    homeDir,
    repoDir,
    gitCommand: String(rawOptions.git ?? process.env.GOLDBAND_GIT ?? 'git'),
    selfUpdateTimeoutSeconds: Number.parseFloat(
      String(rawOptions['self-update-timeout'] ?? process.env.GOLDBAND_SELF_UPDATE_TIMEOUT ?? '4'),
    ) || 4,
    forceFileCopy: rawOptions['force-file-copy'] || process.env.GOLDBAND_TEST_FORCE_FILE_COPY === '1',
    colorsEnabled: process.stdout.isTTY && !rawOptions['no-color'],
    skipWorkflow: rawOptions['skip-workflow'] || process.env.GOLDBAND_SKIP_WORKFLOW === '1',
    workflowRepoDir: rawOptions['workflow-repo']
      ? path.resolve(String(rawOptions['workflow-repo']))
      : null,
    paths: {
      claudeDir,
      skillsDir: path.join(claudeDir, 'skills'),
      skillProfileFile: path.join(claudeDir, 'skills', '.goldband-profile'),
      claudeBinDir: path.join(claudeDir, 'bin'),
      claudeShellDir: path.join(claudeDir, 'shell'),
      settingsJson: path.join(claudeDir, 'settings.json'),
      windowsStateFile: path.join(claudeDir, '.goldband-windows-state.json'),
      shellUpdateBinPs1: path.join(claudeDir, 'bin', 'goldband-self-update.ps1'),
      shellLaunchersPs1: path.join(claudeDir, 'shell', 'goldband-launchers.ps1'),
      codexDir,
      codexConfigFile: path.join(codexDir, 'config.toml'),
      codexAgentsFile: path.join(codexDir, 'AGENTS.md'),
      codexRulesDir: path.join(codexDir, 'rules'),
      codexRuntimeSkillsDir: path.join(codexDir, 'skills'),
      codexRuntimeWorkflowDir: path.join(codexDir, 'skills', 'workflow'),
      agentsDir,
      agentsSkillsDir: path.join(agentsDir, 'skills'),
      codexSkillProfileFile: path.join(agentsDir, 'skills', '.goldband-profile'),
      workflowStateDir: path.join(homeDir, '.workflow'),
      powershellProfiles,
    },
  };
}

function joinCsv(values) {
  return values.join(',');
}

function defaultWindowsState() {
  return {
    version: WINDOWS_STATE_VERSION,
    claudeSkillsProfile: null,
    codexSkillsProfile: null,
    claudeComponents: {
      commands: false,
      contexts: false,
      rules: false,
      hooks: false,
      launchers: false,
    },
    codexComponents: {
      config: false,
      agents: false,
      rules: false,
    },
    workflow: {
      claude: false,
      codex: false,
    },
  };
}

function readWindowsState(context) {
  const statePath = context.paths.windowsStateFile;
  if (!fs.existsSync(statePath)) {
    return defaultWindowsState();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const state = defaultWindowsState();
    state.version = parsed.version ?? state.version;
    state.claudeSkillsProfile = parsed.claudeSkillsProfile ?? null;
    state.codexSkillsProfile = parsed.codexSkillsProfile ?? null;
    state.claudeComponents = {
      ...state.claudeComponents,
      ...(parsed.claudeComponents ?? {}),
    };
    state.codexComponents = {
      ...state.codexComponents,
      ...(parsed.codexComponents ?? {}),
    };
    state.workflow = {
      ...state.workflow,
      ...(parsed.workflow ?? {}),
    };
    return state;
  } catch {
    return defaultWindowsState();
  }
}

function writeWindowsState(context, state) {
  ensureDir(path.dirname(context.paths.windowsStateFile));
  fs.writeFileSync(
    context.paths.windowsStateFile,
    `${JSON.stringify({ ...defaultWindowsState(), ...state }, null, 2)}\n`,
    'utf8',
  );
}

function updateWindowsState(context, updater) {
  const state = readWindowsState(context);
  updater(state);
  writeWindowsState(context, state);
  return state;
}

function skillCatalogLines(context) {
  const raw = fs.readFileSync(path.join(context.repoDir, 'shell', 'install', 'skill-catalog.txt'), 'utf8');
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => {
      const [name, claudeTier = '', codexTier = ''] = line.split('|');
      return { name, claudeTier, codexTier };
    });
}

function profileRank(profile) {
  switch (profile) {
    case 'core':
      return 1;
    case 'dev':
      return 2;
    case 'full':
      return 3;
    default:
      return 0;
  }
}

function buildSkillProfileList(context, tool, profile) {
  const requestedRank = profileRank(profile);
  if (requestedRank <= 0) {
    throw new Error(`unsupported profile: ${profile}`);
  }

  const field = tool === 'claude' ? 'claudeTier' : 'codexTier';
  return skillCatalogLines(context)
    .filter((entry) => profileRank(entry[field]) > 0 && profileRank(entry[field]) <= requestedRank)
    .map((entry) => entry.name);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function removePath(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function backupExistingPath(targetPath, context) {
  const backupPath = `${targetPath}.bak.${Date.now()}`;
  fs.renameSync(targetPath, backupPath);
  console.log(`  ${colorize(context.colorsEnabled, 'yellow', '[backup]')} ${targetPath} -> ${backupPath}`);
}

function isSamePath(left, right) {
  return path.resolve(left) === path.resolve(right);
}

function toBashPath(targetPath) {
  if (!targetPath) {
    return targetPath;
  }
  let normalized = targetPath.replace(/\\/g, '/');
  const match = normalized.match(/^([A-Za-z]):\/(.*)$/);
  if (match) {
    const drive = match[1].toLowerCase();
    const rest = match[2];
    normalized = `/${drive}/${rest}`;
  }
  return normalized;
}

function ensureManagedLink(context, sourcePath, destPath, kind) {
  ensureDir(path.dirname(destPath));
  removePath(destPath);

  if (context.realWindows) {
    if (kind === 'dir') {
      fs.symlinkSync(sourcePath, destPath, 'junction');
      return;
    }
    if (context.forceFileCopy) {
      fs.copyFileSync(sourcePath, destPath);
      return;
    }
    try {
      fs.linkSync(sourcePath, destPath);
      return;
    } catch {
      fs.copyFileSync(sourcePath, destPath);
      return;
    }
  }

  fs.symlinkSync(sourcePath, destPath, kind === 'dir' ? 'dir' : 'file');
}

function lstatOrNull(targetPath) {
  try {
    return fs.lstatSync(targetPath);
  } catch {
    return null;
  }
}

function ensureComponent(context, sourcePath, destPath, label, kind) {
  if (!fs.existsSync(sourcePath)) {
    console.log(`  ${colorize(context.colorsEnabled, 'yellow', '[skip]')} ${label} — source missing`);
    return;
  }

  const stat = lstatOrNull(destPath);
  if (stat) {
    if (!context.realWindows && stat.isSymbolicLink()) {
      const currentTarget = fs.readlinkSync(destPath);
      if (isSamePath(path.resolve(path.dirname(destPath), currentTarget), sourcePath)) {
        console.log(`  ${colorize(context.colorsEnabled, 'green', '[ok]')} ${label}`);
        return;
      }
      removePath(destPath);
    } else if (context.realWindows && kind === 'dir' && stat.isSymbolicLink()) {
      removePath(destPath);
    } else {
      backupExistingPath(destPath, context);
    }
  }

  ensureManagedLink(context, sourcePath, destPath, kind);
  console.log(`  ${colorize(context.colorsEnabled, 'green', '[install]')} ${label}`);
}

function refreshManagedComponent(context, sourcePath, destPath, label, kind) {
  if (!fs.existsSync(sourcePath)) {
    console.log(`  ${colorize(context.colorsEnabled, 'yellow', '[skip]')} ${label} — source missing`);
    return;
  }

  ensureManagedLink(context, sourcePath, destPath, kind);
  console.log(`  ${colorize(context.colorsEnabled, 'green', '[refresh]')} ${label}`);
}

function readProfileFile(profilePath) {
  if (!fs.existsSync(profilePath)) {
    return null;
  }

  const lines = fs.readFileSync(profilePath, 'utf8').split(/\r?\n/);
  const data = {};
  for (const line of lines) {
    const index = line.indexOf('=');
    if (index <= 0) {
      continue;
    }
    data[line.slice(0, index)] = line.slice(index + 1);
  }
  return data;
}

function writeProfileFile(profilePath, profile, skills) {
  ensureDir(path.dirname(profilePath));
  const contents = [
    `profile=${profile}`,
    `installed_at=${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}`,
    `skills=${joinCsv(skills)}`,
    '',
  ].join('\n');
  fs.writeFileSync(profilePath, contents, 'utf8');
}

function currentManagedSkillNames(targetDir, knownSkillNames) {
  if (!fs.existsSync(targetDir)) {
    return [];
  }

  return fs.readdirSync(targetDir, { withFileTypes: true })
    .filter((entry) => entry.name !== '.goldband-profile')
    .map((entry) => entry.name)
    .filter((name) => knownSkillNames.has(name));
}

function inferManagedProfile(context, tool, targetDir) {
  const known = new Set(skillCatalogLines(context).map((entry) => entry.name));
  const installed = currentManagedSkillNames(targetDir, known);
  if (installed.length === 0) {
    return null;
  }

  const installedSet = new Set(installed);
  for (const profile of ['core', 'dev', 'full']) {
    const expected = buildSkillProfileList(context, tool, profile);
    const expectedSet = new Set(expected);
    if (installed.length === expected.length && installed.every((name) => expectedSet.has(name))) {
      return profile;
    }
  }

  for (const profile of ['core', 'dev', 'full']) {
    const expected = buildSkillProfileList(context, tool, profile);
    const expectedSet = new Set(expected);
    if (installed.every((name) => expectedSet.has(name))) {
      return profile;
    }
  }

  return null;
}

function cleanupManagedEntries(targetDir, profilePath, fallbackEntries = []) {
  const profile = readProfileFile(profilePath);
  const profileSkills = profile?.skills
    ? profile.skills.split(',').map((value) => value.trim()).filter(Boolean)
    : [];

  const toRemove = [...new Set([...profileSkills, ...fallbackEntries])];
  for (const name of toRemove) {
    removePath(path.join(targetDir, name));
  }
  removePath(profilePath);
}

function installManagedSkillProfile(context, tool, profile, targetDir, profilePath, extraEntries = []) {
  const selectedSkills = buildSkillProfileList(context, tool, profile);
  ensureDir(targetDir);
  cleanupManagedEntries(targetDir, profilePath, extraEntries.map((entry) => entry.destName));

  let installed = 0;
  for (const skill of selectedSkills) {
    const sourceDir = path.join(context.repoDir, 'skills', 'global', skill);
    if (!fs.existsSync(sourceDir)) {
      console.log(`  ${colorize(context.colorsEnabled, 'yellow', '[skip]')} missing skill: ${skill}`);
      continue;
    }
    ensureManagedLink(context, sourceDir, path.join(targetDir, skill), 'dir');
    installed += 1;
  }

  for (const entry of extraEntries) {
    ensureManagedLink(context, entry.sourcePath, path.join(targetDir, entry.destName), 'file');
  }

  writeProfileFile(profilePath, profile, selectedSkills);
  return installed;
}

function managedProfileNeedsSync(context, tool, profile, targetDir, profilePath, extraEntries = []) {
  if (!fs.existsSync(targetDir)) {
    return true;
  }

  const desiredSkills = buildSkillProfileList(context, tool, profile);
  const profileData = readProfileFile(profilePath);
  const currentCsv = profileData?.skills ?? '';
  const desiredCsv = joinCsv(desiredSkills);
  if (currentCsv !== desiredCsv) {
    return true;
  }

  for (const skill of desiredSkills) {
    if (!fs.existsSync(path.join(targetDir, skill))) {
      return true;
    }
  }

  for (const entry of extraEntries) {
    if (!fs.existsSync(path.join(targetDir, entry.destName))) {
      return true;
    }
  }

  return false;
}

function syncExistingManagedProfile(context, tool, targetDir, profilePath, extraEntries = []) {
  const profileData = readProfileFile(profilePath);
  let profile = profileData?.profile ?? null;

  if (!['core', 'dev', 'full'].includes(profile)) {
    profile = inferManagedProfile(context, tool, targetDir);
  }

  if (!profile) {
    return false;
  }

  if (!managedProfileNeedsSync(context, tool, profile, targetDir, profilePath, extraEntries)) {
    return false;
  }

  installManagedSkillProfile(context, tool, profile, targetDir, profilePath, extraEntries);
  return true;
}

function mergeHooksConfig(context) {
  const settingsPath = context.paths.settingsJson;
  const hooksConfig = JSON.parse(fs.readFileSync(HOOKS_CONFIG_FILE, 'utf8'));
  const hooksDir = path.join(context.paths.claudeDir, 'hooks');

  let settings = {};
  if (fs.existsSync(settingsPath)) {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  }

  const replaceTokens = (value) => {
    if (typeof value === 'string') {
      return value
        .replaceAll('${HOOKS_DIR}', hooksDir)
        .replaceAll('${CLAUDE_DIR}', context.paths.claudeDir);
    }
    if (Array.isArray(value)) {
      return value.map((entry) => replaceTokens(entry));
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, replaceTokens(child)]),
      );
    }
    return value;
  };

  const newHooks = replaceTokens(hooksConfig.hooks ?? {});
  const existingHooks = settings.hooks ?? {};
  const mergedHooks = {};

  const mergeBy = (phase, keySelector) => {
    const combined = [...(existingHooks[phase] ?? []), ...(newHooks[phase] ?? [])];
    const map = new Map();
    for (const entry of combined) {
      map.set(keySelector(entry), entry);
    }
    return [...map.values()];
  };

  mergedHooks.UserPromptSubmit = mergeBy('UserPromptSubmit', (entry) => entry.hooks?.[0]?.command ?? JSON.stringify(entry));
  mergedHooks.PreToolUse = mergeBy('PreToolUse', (entry) => entry.hooks?.[0]?.command ?? JSON.stringify(entry));
  mergedHooks.PostToolUse = mergeBy('PostToolUse', (entry) => entry.hooks?.[0]?.command ?? JSON.stringify(entry));
  mergedHooks.Stop = mergeBy('Stop', (entry) => entry.hooks?.[0]?.command ?? JSON.stringify(entry));
  mergedHooks.SubagentStop = mergeBy('SubagentStop', (entry) => entry.description ?? JSON.stringify(entry));
  mergedHooks.Notification = mergeBy('Notification', (entry) => entry.description ?? JSON.stringify(entry));

  settings.hooks = mergedHooks;

  const statusLine = replaceTokens(hooksConfig.statusLine ?? null);
  if (statusLine) {
    settings.statusLine = statusLine;
  }

  const permissions = hooksConfig.permissions ?? null;
  if (permissions) {
    const existingPermissions = settings.permissions ?? {};
    settings.permissions = {
      ...existingPermissions,
      defaultMode: permissions.defaultMode ?? existingPermissions.defaultMode ?? 'default',
      allow: [...new Set([...(existingPermissions.allow ?? []), ...(permissions.allow ?? [])])],
      deny: [...new Set([...(existingPermissions.deny ?? []), ...(permissions.deny ?? [])])],
    };
  }

  ensureDir(path.dirname(settingsPath));
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

function removeHooksConfig(context) {
  const settingsPath = context.paths.settingsJson;
  if (!fs.existsSync(settingsPath)) {
    return;
  }

  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch {
    return;
  }

  const hooksConfig = JSON.parse(fs.readFileSync(HOOKS_CONFIG_FILE, 'utf8'));
  const hookPhases = Object.keys(hooksConfig.hooks ?? {});
  for (const phase of hookPhases) {
    delete settings.hooks?.[phase];
  }
  if (settings.hooks && Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  const expectedStatusLineCommand = `bash ${path.join(context.paths.claudeDir, 'statusline-command.sh')}`;
  if (settings.statusLine?.type === 'command' && settings.statusLine.command === expectedStatusLineCommand) {
    delete settings.statusLine;
  }

  const permissions = hooksConfig.permissions ?? null;
  if (permissions && settings.permissions) {
    if (Array.isArray(settings.permissions.allow) && Array.isArray(permissions.allow)) {
      const denySet = new Set(permissions.allow);
      settings.permissions.allow = settings.permissions.allow.filter((entry) => !denySet.has(entry));
    }
    if (Array.isArray(settings.permissions.deny) && Array.isArray(permissions.deny)) {
      const denySet = new Set(permissions.deny);
      settings.permissions.deny = settings.permissions.deny.filter((entry) => !denySet.has(entry));
    }
    if (settings.permissions.allow?.length === 0) {
      delete settings.permissions.allow;
    }
    if (settings.permissions.deny?.length === 0) {
      delete settings.permissions.deny;
    }
    if (Object.keys(settings.permissions).length === 0) {
      delete settings.permissions;
    }
  }

  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

function powershellProfileBlock() {
  return [
    '# >>> goldband powershell launchers >>>',
    'if (Test-Path "$HOME/.claude/shell/goldband-launchers.ps1") {',
    '    . "$HOME/.claude/shell/goldband-launchers.ps1"',
    '}',
    '# <<< goldband powershell launchers <<<',
  ].join('\n');
}

function stripProfileBlock(contents, beginMarker, endMarker) {
  const lines = contents.split(/\r?\n/);
  const output = [];
  let skipping = false;

  for (const line of lines) {
    if (line === beginMarker) {
      skipping = true;
      continue;
    }
    if (skipping && line === endMarker) {
      skipping = false;
      continue;
    }
    if (!skipping) {
      output.push(line);
    }
  }

  return output.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
}

function writeWindowsLauncherWrappers(context) {
  ensureDir(context.paths.claudeBinDir);
  ensureDir(context.paths.claudeShellDir);

  const nodePath = process.execPath.replace(/'/g, "''");
  const repoPath = context.repoDir.replace(/'/g, "''");
  const selfUpdateScript = [
    '$ErrorActionPreference = "Stop"',
    '$commandName = $null',
    'if ($args.Length -gt 0) { $commandName = $args[0] }',
    `& '${nodePath}' '${path.join(repoPath, 'scripts', 'goldband-windows.mjs').replace(/'/g, "''")}' self-update --repo '${repoPath}'`,
  ].join('\n');
  fs.writeFileSync(context.paths.shellUpdateBinPs1, `${selfUpdateScript}\n`, 'utf8');

  const launchersScript = [
    '$ErrorActionPreference = "Stop"',
    '',
    'function Invoke-GoldbandExternalCommand {',
    '    param(',
    '        [Parameter(Mandatory = $true)][string]$CommandName,',
    '        [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments',
    '    )',
    '    $command = Get-Command $CommandName -CommandType Application,ExternalScript | Select-Object -First 1',
    '    if (-not $command) {',
    '        throw "Command not found: $CommandName"',
    '    }',
    '    & $command.Source @Arguments',
    '}',
    '',
    'function Invoke-GoldbandPrelaunchUpdate {',
    '    param([string]$CommandName)',
    '    $updateScript = "$HOME/.claude/bin/goldband-self-update.ps1"',
    '    if (Test-Path $updateScript) {',
    '        & $updateScript $CommandName | Out-Null',
    '    }',
    '}',
    '',
    'function claude {',
    '    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)',
    '    Invoke-GoldbandPrelaunchUpdate "claude"',
    '    Invoke-GoldbandExternalCommand "claude" @Arguments',
    '}',
    '',
    'function codex {',
    '    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)',
    '    Invoke-GoldbandPrelaunchUpdate "codex"',
    '    Invoke-GoldbandExternalCommand "codex" @Arguments',
    '}',
  ].join('\n');
  fs.writeFileSync(context.paths.shellLaunchersPs1, `${launchersScript}\n`, 'utf8');

  const beginMarker = '# >>> goldband powershell launchers >>>';
  const endMarker = '# <<< goldband powershell launchers <<<';
  const block = powershellProfileBlock();
  for (const profilePath of context.paths.powershellProfiles) {
    ensureDir(path.dirname(profilePath));
    const current = fs.existsSync(profilePath) ? fs.readFileSync(profilePath, 'utf8') : '';
    const stripped = stripProfileBlock(current, beginMarker, endMarker);
    const next = stripped.length > 0 ? `${stripped}\n\n${block}\n` : `${block}\n`;
    fs.writeFileSync(profilePath, next, 'utf8');
  }

  updateWindowsState(context, (state) => {
    state.claudeComponents.launchers = true;
  });
}

function removeWindowsLauncherWrappers(context) {
  removePath(context.paths.shellUpdateBinPs1);
  removePath(context.paths.shellLaunchersPs1);

  const beginMarker = '# >>> goldband powershell launchers >>>';
  const endMarker = '# <<< goldband powershell launchers <<<';
  for (const profilePath of context.paths.powershellProfiles) {
    if (!fs.existsSync(profilePath)) {
      continue;
    }
    const stripped = stripProfileBlock(fs.readFileSync(profilePath, 'utf8'), beginMarker, endMarker);
    fs.writeFileSync(profilePath, stripped.length > 0 ? `${stripped}\n` : '', 'utf8');
  }
}

function findBashExecutable() {
  const candidates = [
    process.env.GOLDBAND_BASH,
    'bash',
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
  ].filter(Boolean);

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['--version'], { stdio: 'ignore' });
    if (result.status === 0) {
      return candidate;
    }
  }

  return null;
}

function runWorkflowHelper(context, host) {
  if (context.skipWorkflow) {
    return;
  }

  const bash = findBashExecutable();
  if (!bash) {
    throw new Error('workflow install requires bash (Git Bash on Windows)');
  }

  const helperScript = path.join(context.repoDir, 'shell', 'goldband-install-workflow.sh');
  const env = { ...process.env };
  if (!context.realWindows || context.homeDir !== os.homedir()) {
    env.HOME = context.realWindows ? toBashPath(context.homeDir) : context.homeDir;
  }
  if (context.workflowRepoDir) {
    env.WORKFLOW_REPO_DIR = context.realWindows ? toBashPath(context.workflowRepoDir) : context.workflowRepoDir;
  }

  const result = spawnSync(bash, [helperScript, host], {
    cwd: context.repoDir,
    env,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    throw new Error(`workflow install failed for host=${host}`);
  }

  updateWindowsState(context, (state) => {
    if (host === 'auto' || host === 'claude') {
      state.workflow.claude = true;
    }
    if (host === 'auto' || host === 'codex') {
      state.workflow.codex = true;
    }
  });
}

function installSkills(context, profile) {
  const count = installManagedSkillProfile(
    context,
    'claude',
    profile,
    context.paths.skillsDir,
    context.paths.skillProfileFile,
    [
      {
        sourcePath: path.join(context.repoDir, 'skills', 'global', 'README.md'),
        destName: 'README.md',
      },
      {
        sourcePath: path.join(context.repoDir, 'skills', 'global', 'skill-rules.json'),
        destName: 'skill-rules.json',
      },
    ],
  );
  updateWindowsState(context, (state) => {
    state.claudeSkillsProfile = profile;
  });
  console.log(`  ${colorize(context.colorsEnabled, 'green', '[install]')} Claude skills profile: ${profile} (${count})`);
}

function installCodexSkills(context, profile) {
  const count = installManagedSkillProfile(
    context,
    'codex',
    profile,
    context.paths.agentsSkillsDir,
    context.paths.codexSkillProfileFile,
    [],
  );
  updateWindowsState(context, (state) => {
    state.codexSkillsProfile = profile;
  });
  console.log(`  ${colorize(context.colorsEnabled, 'green', '[install]')} Codex skills profile: ${profile} (${count})`);
}

function installCommands(context) {
  ensureComponent(context, path.join(context.repoDir, 'commands'), path.join(context.paths.claudeDir, 'commands'), 'Commands', 'dir');
  updateWindowsState(context, (state) => {
    state.claudeComponents.commands = true;
  });
}

function installContexts(context) {
  ensureComponent(context, path.join(context.repoDir, 'contexts'), path.join(context.paths.claudeDir, 'contexts'), 'Contexts', 'dir');
  updateWindowsState(context, (state) => {
    state.claudeComponents.contexts = true;
  });
}

function installRules(context) {
  ensureComponent(context, path.join(context.repoDir, 'rules'), path.join(context.paths.claudeDir, 'rules'), 'Rules', 'dir');
  updateWindowsState(context, (state) => {
    state.claudeComponents.rules = true;
  });
}

function installHooks(context) {
  ensureComponent(context, path.join(context.repoDir, 'hooks', 'scripts'), path.join(context.paths.claudeDir, 'hooks', 'scripts'), 'Hook Scripts', 'dir');
  ensureComponent(context, path.join(context.repoDir, 'hooks', 'statusline-command.sh'), path.join(context.paths.claudeDir, 'statusline-command.sh'), 'Statusline Script', 'file');
  mergeHooksConfig(context);
  updateWindowsState(context, (state) => {
    state.claudeComponents.hooks = true;
  });
  console.log(`  ${colorize(context.colorsEnabled, 'green', '[merge]')} Claude settings.json hooks/statusLine/permissions`);
}

function installCodexConfig(context) {
  ensureComponent(context, path.join(context.repoDir, 'codex', 'config.toml'), context.paths.codexConfigFile, 'Codex config.toml', 'file');
  updateWindowsState(context, (state) => {
    state.codexComponents.config = true;
  });
}

function installCodexAgents(context) {
  ensureComponent(context, path.join(context.repoDir, 'codex', 'AGENTS.md'), context.paths.codexAgentsFile, 'Codex AGENTS.md', 'file');
  updateWindowsState(context, (state) => {
    state.codexComponents.agents = true;
  });
}

function installCodexRules(context) {
  ensureComponent(context, path.join(context.repoDir, 'codex', 'rules'), context.paths.codexRulesDir, 'Codex Rules', 'dir');
  updateWindowsState(context, (state) => {
    state.codexComponents.rules = true;
  });
}

function installUnity(context, cwd) {
  const targetRoot = path.resolve(cwd ?? process.cwd());
  const unityDir = path.join(targetRoot, '.claude', 'skills');
  ensureComponent(context, path.join(context.repoDir, 'skills', 'projects', 'unity'), unityDir, 'Unity Skills', 'dir');
}

function syncSkills(context) {
  let changed = false;
  if (syncExistingManagedProfile(context, 'claude', context.paths.skillsDir, context.paths.skillProfileFile, [
    {
      sourcePath: path.join(context.repoDir, 'skills', 'global', 'README.md'),
      destName: 'README.md',
    },
    {
      sourcePath: path.join(context.repoDir, 'skills', 'global', 'skill-rules.json'),
      destName: 'skill-rules.json',
    },
  ])) {
    changed = true;
    console.log('[goldband] synced Claude skills profile from repo catalog.');
  }

  if (syncExistingManagedProfile(context, 'codex', context.paths.agentsSkillsDir, context.paths.codexSkillProfileFile, [])) {
    changed = true;
    console.log('[goldband] synced Codex skills profile from repo catalog.');
  }

  return changed;
}

function runGit(context, args, options = {}) {
  const timeoutSeconds = options.timeoutSeconds ?? context.selfUpdateTimeoutSeconds;
  const timeoutMs = Number.isFinite(timeoutSeconds) && timeoutSeconds > 0
    ? Math.round(timeoutSeconds * 1000)
    : undefined;
  const result = spawnSync(context.gitCommand, args, {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
    },
    stdio: options.capture ? 'pipe' : 'ignore',
    timeout: timeoutMs,
    windowsHide: true,
  });

  if (result.error?.code === 'ETIMEDOUT') {
    return {
      status: 124,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  }

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function currentBranch(context, repoDir) {
  const result = runGit(context, ['-C', repoDir, 'rev-parse', '--abbrev-ref', 'HEAD'], { capture: true });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.trim();
}

function currentUpstream(context, repoDir) {
  const result = runGit(context, ['-C', repoDir, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { capture: true });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.trim();
}

function gitStdout(context, repoDir, args) {
  const result = runGit(context, ['-C', repoDir, ...args], { capture: true });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.trim();
}

function refreshManagedRuntime(context) {
  const state = readWindowsState(context);

  if (state.claudeSkillsProfile) {
    installManagedSkillProfile(
      context,
      'claude',
      state.claudeSkillsProfile,
      context.paths.skillsDir,
      context.paths.skillProfileFile,
      [
        {
          sourcePath: path.join(context.repoDir, 'skills', 'global', 'README.md'),
          destName: 'README.md',
        },
        {
          sourcePath: path.join(context.repoDir, 'skills', 'global', 'skill-rules.json'),
          destName: 'skill-rules.json',
        },
      ],
    );
  }

  if (state.codexSkillsProfile) {
    installManagedSkillProfile(
      context,
      'codex',
      state.codexSkillsProfile,
      context.paths.agentsSkillsDir,
      context.paths.codexSkillProfileFile,
      [],
    );
  }

  if (state.claudeComponents.commands) {
    refreshManagedComponent(context, path.join(context.repoDir, 'commands'), path.join(context.paths.claudeDir, 'commands'), 'Commands', 'dir');
  }
  if (state.claudeComponents.contexts) {
    refreshManagedComponent(context, path.join(context.repoDir, 'contexts'), path.join(context.paths.claudeDir, 'contexts'), 'Contexts', 'dir');
  }
  if (state.claudeComponents.rules) {
    refreshManagedComponent(context, path.join(context.repoDir, 'rules'), path.join(context.paths.claudeDir, 'rules'), 'Rules', 'dir');
  }
  if (state.claudeComponents.hooks) {
    refreshManagedComponent(context, path.join(context.repoDir, 'hooks', 'scripts'), path.join(context.paths.claudeDir, 'hooks', 'scripts'), 'Hook Scripts', 'dir');
    refreshManagedComponent(context, path.join(context.repoDir, 'hooks', 'statusline-command.sh'), path.join(context.paths.claudeDir, 'statusline-command.sh'), 'Statusline Script', 'file');
    mergeHooksConfig(context);
  }
  if (state.claudeComponents.launchers) {
    writeWindowsLauncherWrappers(context);
  }
  if (state.codexComponents.config) {
    refreshManagedComponent(context, path.join(context.repoDir, 'codex', 'config.toml'), context.paths.codexConfigFile, 'Codex config.toml', 'file');
  }
  if (state.codexComponents.agents) {
    refreshManagedComponent(context, path.join(context.repoDir, 'codex', 'AGENTS.md'), context.paths.codexAgentsFile, 'Codex AGENTS.md', 'file');
  }
  if (state.codexComponents.rules) {
    refreshManagedComponent(context, path.join(context.repoDir, 'codex', 'rules'), context.paths.codexRulesDir, 'Codex Rules', 'dir');
  }
  if (state.workflow.claude && state.workflow.codex) {
    try {
      runWorkflowHelper(context, 'auto');
    } catch (error) {
      console.error(`[goldband] workflow refresh skipped: ${error.message}`);
    }
  } else if (state.workflow.claude) {
    try {
      runWorkflowHelper(context, 'claude');
    } catch (error) {
      console.error(`[goldband] workflow refresh skipped: ${error.message}`);
    }
  } else if (state.workflow.codex) {
    try {
      runWorkflowHelper(context, 'codex');
    } catch (error) {
      console.error(`[goldband] workflow refresh skipped: ${error.message}`);
    }
  }
}

function selfUpdate(context) {
  syncSkills(context);
  refreshManagedRuntime(context);

  const repoDir = context.repoDir;
  if (!fs.existsSync(path.join(repoDir, '.git'))) {
    return;
  }

  if (currentBranch(context, repoDir) !== 'main') {
    return;
  }
  if (currentUpstream(context, repoDir) !== 'origin/main') {
    return;
  }
  const dirtyStatus = gitStdout(context, repoDir, ['status', '--porcelain']) ?? 'dirty';
  if (dirtyStatus.length > 0) {
    return;
  }

  const fetch = runGit(context, ['-C', repoDir, 'fetch', '--quiet', 'origin', 'main']);
  if (fetch.status !== 0) {
    return;
  }

  const counts = gitStdout(context, repoDir, ['rev-list', '--left-right', '--count', 'HEAD...origin/main']);
  if (!counts) {
    return;
  }
  const [aheadRaw, behindRaw] = counts.split(/\s+/);
  const ahead = Number.parseInt(aheadRaw, 10) || 0;
  const behind = Number.parseInt(behindRaw, 10) || 0;
  if (behind <= 0 || ahead !== 0) {
    return;
  }

  const oldHead = gitStdout(context, repoDir, ['rev-parse', '--short', 'HEAD']) ?? 'unknown';
  const pull = runGit(context, ['-C', repoDir, 'pull', '--ff-only', '--quiet', 'origin', 'main']);
  if (pull.status !== 0) {
    return;
  }
  const newHead = gitStdout(context, repoDir, ['rev-parse', '--short', 'HEAD']) ?? 'unknown';
  if (newHead !== oldHead) {
    syncSkills(context);
    refreshManagedRuntime(context);
    console.error(`[goldband] updated ${oldHead} -> ${newHead}; new sessions will use the latest config.`);
  }
}

function uninstallWindows(context) {
  cleanupManagedEntries(context.paths.skillsDir, context.paths.skillProfileFile, ['README.md', 'skill-rules.json']);
  cleanupManagedEntries(context.paths.agentsSkillsDir, context.paths.codexSkillProfileFile, []);

  const componentPaths = [
    path.join(context.paths.claudeDir, 'commands'),
    path.join(context.paths.claudeDir, 'contexts'),
    path.join(context.paths.claudeDir, 'rules'),
    path.join(context.paths.claudeDir, 'hooks'),
    path.join(context.paths.claudeDir, 'statusline-command.sh'),
    context.paths.codexConfigFile,
    context.paths.codexAgentsFile,
    context.paths.codexRulesDir,
  ];
  for (const targetPath of componentPaths) {
    removePath(targetPath);
  }

  removeHooksConfig(context);
  removeWindowsLauncherWrappers(context);
  removePath(context.paths.windowsStateFile);
}

function powershellProfilesInstalled(context) {
  return context.paths.powershellProfiles.some((profilePath) => {
    if (!fs.existsSync(profilePath)) {
      return false;
    }
    return fs.readFileSync(profilePath, 'utf8').includes('. "$HOME/.claude/shell/goldband-launchers.ps1"');
  });
}

function showWindowsStatus(context) {
  const claudeProfile = readProfileFile(context.paths.skillProfileFile);
  const codexProfile = readProfileFile(context.paths.codexSkillProfileFile);

  console.log('goldband Windows status');
  console.log('');
  console.log(`  Claude skills profile: ${claudeProfile?.profile ?? 'missing'} (${claudeProfile?.skills?.split(',').filter(Boolean).length ?? 0})`);
  console.log(`  Codex skills profile: ${codexProfile?.profile ?? 'missing'} (${codexProfile?.skills?.split(',').filter(Boolean).length ?? 0})`);
  console.log(`  Claude commands: ${fs.existsSync(path.join(context.paths.claudeDir, 'commands')) ? 'installed' : 'missing'}`);
  console.log(`  Claude contexts: ${fs.existsSync(path.join(context.paths.claudeDir, 'contexts')) ? 'installed' : 'missing'}`);
  console.log(`  Claude rules: ${fs.existsSync(path.join(context.paths.claudeDir, 'rules')) ? 'installed' : 'missing'}`);
  console.log(`  Codex config: ${fs.existsSync(context.paths.codexConfigFile) ? 'installed' : 'missing'}`);
  console.log(`  Codex agents: ${fs.existsSync(context.paths.codexAgentsFile) ? 'installed' : 'missing'}`);
  console.log(`  Codex rules: ${fs.existsSync(context.paths.codexRulesDir) ? 'installed' : 'missing'}`);
  console.log(`  PowerShell launchers: ${powershellProfilesInstalled(context) ? 'installed' : 'missing'}`);
  console.log(`  Workflow Claude runtime: ${fs.existsSync(path.join(context.paths.claudeDir, 'skills', 'workflow')) ? 'installed' : 'missing'}`);
  console.log(`  Workflow Codex runtime: ${fs.existsSync(context.paths.codexRuntimeWorkflowDir) ? 'installed' : 'missing'}`);
}

function installForWindows(context, actions) {
  for (const action of actions) {
    switch (action) {
      case 'pack-core':
        installSkills(context, 'core');
        installRules(context);
        installHooks(context);
        writeWindowsLauncherWrappers(context);
        break;
      case 'pack-quality':
      case 'all':
        installSkills(context, 'dev');
        installCommands(context);
        installContexts(context);
        installRules(context);
        installHooks(context);
        writeWindowsLauncherWrappers(context);
        break;
      case 'all-full':
        installSkills(context, 'full');
        installCommands(context);
        installContexts(context);
        installRules(context);
        installHooks(context);
        writeWindowsLauncherWrappers(context);
        break;
      case 'skills':
      case 'skills-full':
        installSkills(context, 'full');
        break;
      case 'skills-core':
        installSkills(context, 'core');
        break;
      case 'skills-dev':
        installSkills(context, 'dev');
        break;
      case 'commands':
        installCommands(context);
        break;
      case 'contexts':
        installContexts(context);
        break;
      case 'rules':
        installRules(context);
        break;
      case 'hooks':
        installHooks(context);
        break;
      case 'launchers':
        writeWindowsLauncherWrappers(context);
        break;
      case 'codex-config':
        installCodexConfig(context);
        break;
      case 'codex-agents':
        installCodexAgents(context);
        break;
      case 'codex-rules':
        installCodexRules(context);
        break;
      case 'codex-skills':
        installCodexSkills(context, 'full');
        break;
      case 'codex-core':
        installCodexConfig(context);
        installCodexAgents(context);
        installCodexRules(context);
        installCodexSkills(context, 'core');
        writeWindowsLauncherWrappers(context);
        break;
      case 'codex-full':
      case 'codex':
        installCodexConfig(context);
        installCodexAgents(context);
        installCodexRules(context);
        installCodexSkills(context, 'full');
        writeWindowsLauncherWrappers(context);
        break;
      case 'all-tools':
        installSkills(context, 'full');
        installCommands(context);
        installContexts(context);
        installRules(context);
        installHooks(context);
        writeWindowsLauncherWrappers(context);
        installCodexConfig(context);
        installCodexAgents(context);
        installCodexRules(context);
        installCodexSkills(context, 'full');
        break;
      case 'workflow':
        runWorkflowHelper(context, 'claude');
        break;
      case 'workflow-codex':
        runWorkflowHelper(context, 'codex');
        break;
      case 'workflow-auto':
        runWorkflowHelper(context, 'auto');
        break;
      case 'all-with-workflow':
        installForWindows(context, ['all-tools']);
        runWorkflowHelper(context, 'auto');
        break;
      case 'status':
        showWindowsStatus(context);
        break;
      case 'uninstall':
        uninstallWindows(context);
        break;
      case 'unity':
      case 'pack-unity':
        installForWindows(context, ['pack-quality']);
        installUnity(context);
        break;
      case 'help':
      case '-h':
      case '--help':
        printHelp();
        break;
      default:
        throw new Error(`unsupported action: ${action}`);
    }
  }
}

function printHelp() {
  console.log('Usage: node scripts/goldband-windows.mjs <command> [actions...] [--home PATH] [--platform win32]');
  console.log('');
  console.log('Commands:');
  console.log('  install <actions...>   Run Windows/native install actions');
  console.log('  sync-skills            Reconcile managed Claude/Codex skill profiles from repo catalog');
  console.log('  self-update            Sync managed skills, then fast-forward goldband when safe');
  console.log('  status                 Show Windows install status');
  console.log('  uninstall              Remove Windows install artifacts managed by this script');
}

function main() {
  const { positional, options } = parseArgs(process.argv.slice(2));
  const command = positional[0] ?? 'help';
  const context = createContext(options);

  switch (command) {
    case 'install': {
      const actions = positional.slice(1);
      if (actions.length === 0) {
        actions.push('all-tools');
      }
      installForWindows(context, actions);
      return;
    }
    case 'sync-skills':
      syncSkills(context);
      return;
    case 'self-update':
      selfUpdate(context);
      return;
    case 'status':
      showWindowsStatus(context);
      return;
    case 'uninstall':
      uninstallWindows(context);
      return;
    case 'help':
    default:
      printHelp();
  }
}

main();
