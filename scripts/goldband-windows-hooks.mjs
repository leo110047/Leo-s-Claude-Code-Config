import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {
  ensureDir,
  HOOKS_CONFIG_FILE,
  readRetiredClaudePermissionAllow,
  removePath,
  toBashPath,
  updateWindowsState,
} from './goldband-windows-core.mjs';

function mergeHooksConfig(context) {
  const settingsPath = context.paths.settingsJson;
  const hooksConfig = JSON.parse(fs.readFileSync(HOOKS_CONFIG_FILE, 'utf8'));
  const settings = readJsonFile(settingsPath, {});
  const replaceTokens = buildTokenReplacer(context);
  const newHooks = replaceTokens(hooksConfig.hooks ?? {});
  settings.hooks = mergeHookPhases(settings.hooks ?? {}, newHooks);

  const statusLine = replaceTokens(hooksConfig.statusLine ?? null);
  if (statusLine) {
    settings.statusLine = statusLine;
  }

  const permissions = hooksConfig.permissions ?? null;
  if (permissions) {
    settings.permissions = mergePermissions(context, settings, permissions);
  }

  ensureDir(path.dirname(settingsPath));
  writeJsonFile(settingsPath, settings);
}

function removeHooksConfig(context) {
  const settingsPath = context.paths.settingsJson;
  if (!fs.existsSync(settingsPath)) {
    return;
  }

  const settings = readJsonFile(settingsPath, null);
  if (!settings) {
    return;
  }

  const hooksConfig = JSON.parse(fs.readFileSync(HOOKS_CONFIG_FILE, 'utf8'));
  removeHookPhases(settings, hooksConfig);
  removeStatusLine(settings, context);
  removePermissions(settings, hooksConfig.permissions ?? null);
  writeJsonFile(settingsPath, settings);
}

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function buildTokenReplacer(context) {
  const hooksDir = path.join(context.paths.claudeDir, 'hooks');
  return function replaceTokens(value) {
    if (typeof value === 'string') {
      return value
        .replaceAll('${HOOKS_DIR}', hooksDir)
        .replaceAll('${CLAUDE_DIR}', context.paths.claudeDir);
    }
    if (Array.isArray(value)) return value.map((entry) => replaceTokens(entry));
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [
          key,
          replaceTokens(child),
        ]),
      );
    }
    return value;
  };
}

function hookKey(entry) {
  return (
    entry.hooks?.[0]?.command ??
    entry.hooks?.[0]?.prompt ??
    entry.description ??
    JSON.stringify(entry)
  );
}

function mergeHookEntries(existing, incoming) {
  const map = new Map();
  for (const entry of [...existing, ...incoming]) {
    map.set(hookKey(entry), entry);
  }
  return [...map.values()];
}

function mergeHookPhases(existingHooks, newHooks) {
  const mergedHooks = {};
  for (const phase of [
    'UserPromptSubmit',
    'PreToolUse',
    'PostToolUse',
    'Stop',
    'SubagentStop',
    'Notification',
  ]) {
    mergedHooks[phase] = mergeHookEntries(
      existingHooks[phase] ?? [],
      newHooks[phase] ?? [],
    );
  }
  return mergedHooks;
}

function mergePermissions(context, settings, permissions) {
  const existingPermissions = settings.permissions ?? {};
  const retiredAllow = new Set(readRetiredClaudePermissionAllow(context));
  return {
    ...existingPermissions,
    defaultMode:
      permissions.defaultMode ?? existingPermissions.defaultMode ?? 'default',
    allow: [
      ...new Set([
        ...(existingPermissions.allow ?? []).filter(
          (entry) => !retiredAllow.has(entry),
        ),
        ...(permissions.allow ?? []),
      ]),
    ],
    deny: [
      ...new Set([
        ...(existingPermissions.deny ?? []),
        ...(permissions.deny ?? []),
      ]),
    ],
  };
}

function removeHookPhases(settings, hooksConfig) {
  for (const phase of Object.keys(hooksConfig.hooks ?? {})) {
    delete settings.hooks?.[phase];
  }
  if (settings.hooks && Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }
}

function removeStatusLine(settings, context) {
  const expectedCommand = statusLineCommand(context);
  if (
    settings.statusLine?.type === 'command' &&
    settings.statusLine.command === expectedCommand
  ) {
    delete settings.statusLine;
  }
}

function statusLineCommand(context) {
  return `bash ${context.paths.claudeDir}/statusline-command.sh`;
}

function removePermissions(settings, permissions) {
  if (!permissions || !settings.permissions) return;
  removePermissionList(settings.permissions, permissions, 'allow');
  removePermissionList(settings.permissions, permissions, 'deny');
  if (Object.keys(settings.permissions).length === 0) {
    delete settings.permissions;
  }
}

function removePermissionList(settingsPermissions, permissions, key) {
  if (
    !Array.isArray(settingsPermissions[key]) ||
    !Array.isArray(permissions[key])
  ) {
    return;
  }
  const denySet = new Set(permissions[key]);
  settingsPermissions[key] = settingsPermissions[key].filter(
    (entry) => !denySet.has(entry),
  );
  if (settingsPermissions[key].length === 0) {
    delete settingsPermissions[key];
  }
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

  return output
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+$/, '');
}

function writeWindowsLauncherWrappers(context) {
  ensureDir(context.paths.claudeBinDir);
  ensureDir(context.paths.claudeShellDir);
  fs.writeFileSync(
    context.paths.shellUpdateBinPs1,
    `${buildSelfUpdateScript(context)}\n`,
    'utf8',
  );
  fs.writeFileSync(
    context.paths.shellLaunchersPs1,
    `${buildLaunchersScript()}\n`,
    'utf8',
  );
  writePowerShellProfileBlocks(context);

  updateWindowsState(context, (state) => {
    state.claudeComponents.launchers = true;
  });
}

function escapePowerShellSingleQuoted(value) {
  return value.replace(/'/g, "''");
}

function buildSelfUpdateScript(context) {
  const nodePath = escapePowerShellSingleQuoted(process.execPath);
  const repoPath = escapePowerShellSingleQuoted(context.repoDir);
  const scriptPath = escapePowerShellSingleQuoted(
    path.join(context.repoDir, 'scripts', 'goldband-windows.mjs'),
  );
  return [
    '$ErrorActionPreference = "Stop"',
    '$commandName = $null',
    'if ($args.Length -gt 0) { $commandName = $args[0] }',
    `& '${nodePath}' '${scriptPath}' self-update --repo '${repoPath}'`,
  ].join('\n');
}

function buildLaunchersScript() {
  return [
    '$ErrorActionPreference = "Stop"',
    '',
    ...externalCommandFunctionLines(),
    '',
    ...prelaunchFunctionLines(),
    '',
    ...launcherFunctionLines('claude'),
    '',
    ...launcherFunctionLines('codex'),
  ].join('\n');
}

function externalCommandFunctionLines() {
  return [
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
  ];
}

function prelaunchFunctionLines() {
  return [
    'function Invoke-GoldbandPrelaunchUpdate {',
    '    param([string]$CommandName)',
    '    $updateScript = "$HOME/.claude/bin/goldband-self-update.ps1"',
    '    if (Test-Path $updateScript) {',
    '        & $updateScript $CommandName | Out-Null',
    '    }',
    '}',
  ];
}

function launcherFunctionLines(commandName) {
  return [
    `function ${commandName} {`,
    '    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)',
    `    Invoke-GoldbandPrelaunchUpdate "${commandName}"`,
    `    Invoke-GoldbandExternalCommand "${commandName}" @Arguments`,
    '}',
  ];
}

function writePowerShellProfileBlocks(context) {
  const beginMarker = '# >>> goldband powershell launchers >>>';
  const endMarker = '# <<< goldband powershell launchers <<<';
  const block = powershellProfileBlock();
  for (const profilePath of context.paths.powershellProfiles) {
    ensureDir(path.dirname(profilePath));
    const current = fs.existsSync(profilePath)
      ? fs.readFileSync(profilePath, 'utf8')
      : '';
    const stripped = stripProfileBlock(current, beginMarker, endMarker);
    const next =
      stripped.length > 0 ? `${stripped}\n\n${block}\n` : `${block}\n`;
    fs.writeFileSync(profilePath, next, 'utf8');
  }
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
    const stripped = stripProfileBlock(
      fs.readFileSync(profilePath, 'utf8'),
      beginMarker,
      endMarker,
    );
    fs.writeFileSync(
      profilePath,
      stripped.length > 0 ? `${stripped}\n` : '',
      'utf8',
    );
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

  const helperScript = path.join(
    context.repoDir,
    'shell',
    'goldband-install-workflow.sh',
  );
  const env = { ...process.env };
  if (!context.realWindows || context.homeDir !== os.homedir()) {
    env.HOME = context.realWindows
      ? toBashPath(context.homeDir)
      : context.homeDir;
  }
  if (context.workflowRepoDir) {
    env.WORKFLOW_REPO_DIR = context.realWindows
      ? toBashPath(context.workflowRepoDir)
      : context.workflowRepoDir;
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

export {
  mergeHooksConfig,
  removeHooksConfig,
  removeWindowsLauncherWrappers,
  runWorkflowHelper,
  writeWindowsLauncherWrappers,
};
