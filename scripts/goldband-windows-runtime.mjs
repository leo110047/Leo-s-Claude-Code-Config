import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  installCodexProfileConfigs,
  installCodexRequirements,
  installCodexRulesDirectory,
  writeGeneratedCodexConfig,
} from './goldband-windows-codex.mjs';
import {
  readWindowsState,
  refreshManagedComponent,
} from './goldband-windows-core.mjs';
import {
  mergeHooksConfig,
  runWorkflowHelper,
  writeWindowsLauncherWrappers,
} from './goldband-windows-hooks.mjs';
import {
  installManagedSkillProfile,
  syncExistingManagedProfile,
} from './goldband-windows-profiles.mjs';

function claudeSkillExtras(context) {
  return [
    {
      sourcePath: path.join(context.repoDir, 'skills', 'global', 'README.md'),
      destName: 'README.md',
    },
    {
      sourcePath: path.join(
        context.repoDir,
        'skills',
        'global',
        'skill-rules.json',
      ),
      destName: 'skill-rules.json',
    },
  ];
}

function syncSkills(context) {
  let changed = false;
  if (
    syncExistingManagedProfile(
      context,
      'claude',
      context.paths.skillsDir,
      context.paths.skillProfileFile,
      claudeSkillExtras(context),
    )
  ) {
    changed = true;
    console.log('[goldband] synced Claude skills profile from repo catalog.');
  }

  if (
    syncExistingManagedProfile(
      context,
      'codex',
      context.paths.agentsSkillsDir,
      context.paths.codexSkillProfileFile,
      [],
    )
  ) {
    changed = true;
    console.log('[goldband] synced Codex skills profile from repo catalog.');
  }

  return changed;
}

function refreshManagedRuntime(context, options = {}) {
  const state = readWindowsState(context);
  refreshSkillProfiles(context, state);
  refreshClaudeComponents(context, state);
  refreshCodexComponents(context, state);
  if (options.workflow !== false) {
    refreshWorkflowRuntime(context, state);
  }
}

function refreshSkillProfiles(context, state) {
  if (state.claudeSkillsProfile) {
    installManagedSkillProfile(
      context,
      'claude',
      state.claudeSkillsProfile,
      context.paths.skillsDir,
      context.paths.skillProfileFile,
      claudeSkillExtras(context),
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
}

function refreshClaudeComponents(context, state) {
  for (const component of claudeRefreshComponents(context)) {
    if (state.claudeComponents[component.key]) {
      refreshManagedComponent(context, component);
    }
  }
  if (state.claudeComponents.hooks) {
    mergeHooksConfig(context);
  }
  if (state.claudeComponents.launchers) {
    writeWindowsLauncherWrappers(context);
  }
}

function claudeRefreshComponents(context) {
  return [
    component('commands', context, 'commands', 'commands', 'Commands', 'dir'),
    component(
      'guidance',
      context,
      'claude/CLAUDE.md',
      context.paths.claudeGlobalInstructionsFile,
      'Claude CLAUDE.md',
      'file',
    ),
    component('contexts', context, 'contexts', 'contexts', 'Contexts', 'dir'),
    component('rules', context, 'rules', 'rules', 'Rules', 'dir'),
    component(
      'hooks',
      context,
      'hooks/scripts',
      'hooks/scripts',
      'Hook Scripts',
      'dir',
    ),
    component(
      'hooks',
      context,
      'hooks/statusline-command.sh',
      'statusline-command.sh',
      'Statusline Script',
      'file',
    ),
  ];
}

function refreshCodexComponents(context, state) {
  if (state.codexComponents.config) writeGeneratedCodexConfig(context);
  if (state.codexComponents.profiles) installCodexProfileConfigs(context);
  if (state.codexComponents.requirements) installCodexRequirements(context);
  for (const component of codexRefreshComponents(context)) {
    if (state.codexComponents[component.key]) {
      refreshManagedComponent(context, component);
    }
  }
  if (state.codexComponents.rules) installCodexRulesDirectory(context);
}

function codexRefreshComponents(context) {
  return [
    directComponent(
      'agents',
      path.join(context.repoDir, 'codex', 'AGENTS.md'),
      context.paths.codexAgentsFile,
      'Codex AGENTS.md',
      'file',
    ),
    directComponent(
      'agents',
      path.join(context.repoDir, 'codex', 'agents'),
      context.paths.codexCustomAgentsDir,
      'Codex custom agents',
      'dir',
    ),
    directComponent(
      'hooks',
      path.join(context.repoDir, 'codex', 'hooks.json'),
      context.paths.codexHooksFile,
      'Codex hooks.json',
      'file',
    ),
    directComponent(
      'hooks',
      path.join(context.repoDir, 'codex', 'hooks'),
      context.paths.codexHooksDir,
      'Codex hook scripts',
      'dir',
    ),
  ];
}

function component(...args) {
  const [key, context, source, dest, label, kind] = args;
  const sourcePath = path.isAbsolute(source)
    ? source
    : path.join(context.repoDir, ...source.split('/'));
  const destPath = path.isAbsolute(dest)
    ? dest
    : path.join(context.paths.claudeDir, ...dest.split('/'));
  return directComponent(
    key,
    sourcePath,
    destPath,
    label,
    kind,
  );
}

function directComponent(...args) {
  const [key, sourcePath, destPath, label, kind] = args;
  return { key, sourcePath, destPath, label, kind };
}

function refreshWorkflowRuntime(context, state) {
  const host = workflowHost(state.workflow);
  if (!host) return;
  try {
    runWorkflowHelper(context, host);
  } catch (error) {
    console.error(`[goldband] workflow refresh skipped: ${error.message}`);
  }
}

function workflowHost(workflow) {
  if (workflow.claude && workflow.codex) return 'auto';
  if (workflow.claude) return 'claude';
  if (workflow.codex) return 'codex';
  return null;
}

function runGit(context, args, options = {}) {
  const result = spawnSync(context.gitCommand, args, {
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    stdio: options.capture ? 'pipe' : 'ignore',
    timeout: gitTimeoutMs(context, options),
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

function gitTimeoutMs(context, options) {
  const timeoutSeconds =
    options.timeoutSeconds ?? context.selfUpdateTimeoutSeconds;
  return Number.isFinite(timeoutSeconds) && timeoutSeconds > 0
    ? Math.round(timeoutSeconds * 1000)
    : undefined;
}

function gitStdout(context, repoDir, args) {
  const result = runGit(context, ['-C', repoDir, ...args], { capture: true });
  return result.status === 0 ? result.stdout.trim() : null;
}

function currentBranch(context, repoDir) {
  return gitStdout(context, repoDir, ['rev-parse', '--abbrev-ref', 'HEAD']);
}

function currentUpstream(context, repoDir) {
  return gitStdout(context, repoDir, [
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{upstream}',
  ]);
}

function selfUpdate(context) {
  syncSkills(context);
  refreshManagedRuntime(context, { workflow: false });
  const repoDir = context.repoDir;
  if (!canFastForward(context, repoDir)) return;
  const oldHead =
    gitStdout(context, repoDir, ['rev-parse', '--short', 'HEAD']) ?? 'unknown';
  if (!pullFastForward(context, repoDir)) return;
  const newHead =
    gitStdout(context, repoDir, ['rev-parse', '--short', 'HEAD']) ?? 'unknown';
  if (newHead === oldHead) return;
  refreshManagedRuntime(context);
  console.error(
    `[goldband] updated ${oldHead} -> ${newHead}; new sessions will use the latest config.`,
  );
}

function canFastForward(context, repoDir) {
  if (!fs.existsSync(path.join(repoDir, '.git'))) return false;
  if (currentBranch(context, repoDir) !== 'main') return false;
  if (currentUpstream(context, repoDir) !== 'origin/main') return false;
  const dirtyStatus =
    gitStdout(context, repoDir, ['status', '--porcelain']) ?? 'dirty';
  if (dirtyStatus.length > 0) return false;
  const fetch = runGit(context, [
    '-C',
    repoDir,
    'fetch',
    '--quiet',
    'origin',
    'main',
  ]);
  if (fetch.status !== 0) return false;
  return isBehindOriginMain(context, repoDir);
}

function isBehindOriginMain(context, repoDir) {
  const counts = gitStdout(context, repoDir, [
    'rev-list',
    '--left-right',
    '--count',
    'HEAD...origin/main',
  ]);
  if (!counts) return false;
  const [aheadRaw, behindRaw] = counts.split(/\s+/);
  const ahead = Number.parseInt(aheadRaw, 10) || 0;
  const behind = Number.parseInt(behindRaw, 10) || 0;
  return behind > 0 && ahead === 0;
}

function pullFastForward(context, repoDir) {
  const pull = runGit(context, [
    '-C',
    repoDir,
    'pull',
    '--ff-only',
    '--quiet',
    'origin',
    'main',
  ]);
  return pull.status === 0;
}

export { refreshManagedRuntime, selfUpdate, syncSkills };
