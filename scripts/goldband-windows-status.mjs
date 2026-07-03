import fs from 'node:fs';
import path from 'node:path';
import { readProfileFile } from './goldband-windows-profiles.mjs';

function showWindowsStatus(context) {
  const claudeProfile = readProfileFile(context.paths.skillProfileFile);
  const codexProfile = readProfileFile(context.paths.codexSkillProfileFile);

  console.log('goldband Windows status');
  console.log('');
  for (const line of statusLines(context, claudeProfile, codexProfile)) {
    console.log(line);
  }
}

function statusLines(context, claudeProfile, codexProfile) {
  return [
    profileLine('Claude skills profile', claudeProfile),
    profileLine('Codex skills profile', codexProfile),
    installedLine(
      'Claude CLAUDE.md',
      context.paths.claudeGlobalInstructionsFile,
    ),
    installedLine(
      'Claude commands',
      path.join(context.paths.claudeDir, 'commands'),
    ),
    installedLine('Claude rules', path.join(context.paths.claudeDir, 'rules')),
    installedLine('Codex config', context.paths.codexConfigFile),
    codexProfilesLine(context),
    codexRequirementsLine(context),
    installedLine('Codex agents', context.paths.codexAgentsFile),
    installedLine('Codex custom agents', context.paths.codexCustomAgentsDir),
    codexHooksLine(context),
    codexRulesLine(context),
    `  PowerShell launchers: ${powershellProfilesInstalled(context) ? 'installed' : 'missing'}`,
    installedLine(
      'Workflow Claude runtime',
      path.join(context.paths.claudeDir, 'skills', 'workflow'),
    ),
    installedLine(
      'Workflow Codex runtime',
      context.paths.codexRuntimeWorkflowDir,
    ),
  ];
}

function profileLine(label, profile) {
  const count = profile?.skills?.split(',').filter(Boolean).length ?? 0;
  return `  ${label}: ${profile?.profile ?? 'missing'} (${count})`;
}

function installedLine(label, filePath) {
  return `  ${label}: ${fs.existsSync(filePath) ? 'installed' : 'missing'}`;
}

function codexProfilesLine(context) {
  const expectedProfiles = expectedCodexProfiles(context);
  const installedProfiles = expectedProfiles.filter((name) =>
    fs.existsSync(path.join(context.paths.codexDir, name)),
  );
  const status =
    installedProfiles.length === expectedProfiles.length &&
    expectedProfiles.length > 0
      ? 'installed'
      : 'missing';
  return `  Codex profiles: ${status} (${installedProfiles.length}/${expectedProfiles.length})`;
}

function expectedCodexProfiles(context) {
  const profileDir = path.join(context.repoDir, 'codex', 'profiles');
  return fs.existsSync(profileDir)
    ? fs.readdirSync(profileDir).filter((name) => name.endsWith('.config.toml'))
    : [];
}

function codexRequirementsLine(context) {
  const status = fs.existsSync(context.paths.codexRequirementsFile)
    ? 'staged (Windows enforcement path unverified)'
    : 'missing';
  return `  Codex requirements: ${status}`;
}

function codexHooksLine(context) {
  const installed =
    fs.existsSync(context.paths.codexHooksFile) &&
    fs.existsSync(context.paths.codexHooksDir);
  return `  Codex hooks: ${installed ? 'installed' : 'missing'}`;
}

function codexRulesLine(context) {
  const installed =
    fs.existsSync(path.join(context.paths.codexRulesDir, 'goldband.rules')) &&
    fs.existsSync(path.join(context.paths.codexRulesDir, 'default.rules'));
  return `  Codex rules: ${installed ? 'installed' : 'missing'}`;
}

function powershellProfilesInstalled(context) {
  return context.paths.powershellProfiles.some((profilePath) => {
    if (!fs.existsSync(profilePath)) return false;
    return fs
      .readFileSync(profilePath, 'utf8')
      .includes('. "$HOME/.claude/shell/goldband-launchers.ps1"');
  });
}

export { showWindowsStatus };
