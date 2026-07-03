import path from 'node:path';
import process from 'node:process';
import {
  installCodexProfileConfigs,
  installCodexRulesDirectory,
  writeGeneratedCodexConfig,
} from './goldband-windows-codex.mjs';
import {
  colorize,
  ensureComponent,
  updateWindowsState,
} from './goldband-windows-core.mjs';
import { mergeHooksConfig } from './goldband-windows-hooks.mjs';
import { installManagedSkillProfile } from './goldband-windows-profiles.mjs';

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
        sourcePath: path.join(
          context.repoDir,
          'skills',
          'global',
          'skill-rules.json',
        ),
        destName: 'skill-rules.json',
      },
    ],
  );
  updateWindowsState(context, (state) => {
    state.claudeSkillsProfile = profile;
  });
  console.log(
    `  ${colorize(context.colorsEnabled, 'green', '[install]')} Claude skills profile: ${profile} (${count})`,
  );
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
  console.log(
    `  ${colorize(context.colorsEnabled, 'green', '[install]')} Codex skills profile: ${profile} (${count})`,
  );
}

function installCommands(context) {
  ensureComponent(
    context,
    path.join(context.repoDir, 'commands'),
    path.join(context.paths.claudeDir, 'commands'),
    'Commands',
    'dir',
  );
  updateWindowsState(context, (state) => {
    state.claudeComponents.commands = true;
  });
}

function installClaudeGuidance(context) {
  ensureComponent(
    context,
    path.join(context.repoDir, 'claude', 'CLAUDE.md'),
    context.paths.claudeGlobalInstructionsFile,
    'Claude CLAUDE.md',
    'file',
  );
  updateWindowsState(context, (state) => {
    state.claudeComponents.guidance = true;
  });
}

function installRules(context) {
  ensureComponent(
    context,
    path.join(context.repoDir, 'rules'),
    path.join(context.paths.claudeDir, 'rules'),
    'Rules',
    'dir',
  );
  updateWindowsState(context, (state) => {
    state.claudeComponents.rules = true;
  });
}

function installHooks(context) {
  ensureComponent(
    context,
    path.join(context.repoDir, 'hooks', 'scripts'),
    path.join(context.paths.claudeDir, 'hooks', 'scripts'),
    'Hook Scripts',
    'dir',
  );
  ensureComponent(
    context,
    path.join(context.repoDir, 'hooks', 'statusline-command.sh'),
    path.join(context.paths.claudeDir, 'statusline-command.sh'),
    'Statusline Script',
    'file',
  );
  mergeHooksConfig(context);
  updateWindowsState(context, (state) => {
    state.claudeComponents.hooks = true;
  });
  console.log(
    `  ${colorize(context.colorsEnabled, 'green', '[merge]')} Claude settings.json hooks/statusLine/permissions`,
  );
}

function installCodexConfig(context) {
  writeGeneratedCodexConfig(context);
  installCodexProfileConfigs(context);
  updateWindowsState(context, (state) => {
    state.codexComponents.config = true;
    state.codexComponents.profiles = true;
  });
}

function installCodexAgents(context) {
  ensureComponent(
    context,
    path.join(context.repoDir, 'codex', 'AGENTS.md'),
    context.paths.codexAgentsFile,
    'Codex AGENTS.md',
    'file',
  );
  ensureComponent(
    context,
    path.join(context.repoDir, 'codex', 'agents'),
    context.paths.codexCustomAgentsDir,
    'Codex custom agents',
    'dir',
  );
  updateWindowsState(context, (state) => {
    state.codexComponents.agents = true;
  });
}

function installCodexHooks(context) {
  ensureComponent(
    context,
    path.join(context.repoDir, 'codex', 'hooks.json'),
    context.paths.codexHooksFile,
    'Codex hooks.json',
    'file',
  );
  ensureComponent(
    context,
    path.join(context.repoDir, 'codex', 'hooks'),
    context.paths.codexHooksDir,
    'Codex hook scripts',
    'dir',
  );
  updateWindowsState(context, (state) => {
    state.codexComponents.hooks = true;
  });
}

function installCodexRules(context) {
  installCodexRulesDirectory(context);
  updateWindowsState(context, (state) => {
    state.codexComponents.rules = true;
  });
}

function installUnity(context, cwd) {
  const targetRoot = path.resolve(cwd ?? process.cwd());
  const unityDir = path.join(targetRoot, '.claude', 'skills');
  ensureComponent(
    context,
    path.join(context.repoDir, 'skills', 'projects', 'unity'),
    unityDir,
    'Unity Skills',
    'dir',
  );
}

export {
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
};
