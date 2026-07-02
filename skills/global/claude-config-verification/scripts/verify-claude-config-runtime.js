const fs = require('fs');
const path = require('path');

function checkHookReferences(rootDir) {
  const hooksPath = path.join(rootDir, 'hooks', 'hooks.json');
  if (!fs.existsSync(hooksPath)) {
    return { ok: false, errors: ['hooks/hooks.json missing'], checked: 0 };
  }

  const parsed = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
  const scriptPaths = hookCommands(parsed.hooks || {})
    .map(commandScriptPath)
    .filter(Boolean);
  const errors = scriptPaths
    .filter((scriptPath) => !fs.existsSync(path.join(rootDir, scriptPath)))
    .map((scriptPath) => `${scriptPath} not found`);
  return { ok: errors.length === 0, errors, checked: scriptPaths.length };
}

function hookCommands(hooks) {
  return Object.values(hooks)
    .filter(Array.isArray)
    .flatMap((entries) => entries.flatMap(entryHookCommands));
}

function entryHookCommands(entry) {
  const hookList = Array.isArray(entry.hooks) ? entry.hooks : [];
  return hookList
    .map((hook) => hook.command)
    .filter((command) => typeof command === 'string');
}

function commandScriptPath(command) {
  const match = command.match(/node\s+"([^"]+)"/);
  return match ? match[1].replace('${HOOKS_DIR}', 'hooks') : null;
}

function readProfileFile(profilePath) {
  if (!fs.existsSync(profilePath)) return null;
  const raw = fs.readFileSync(profilePath, 'utf8');
  const fields = {};
  for (const line of raw.split('\n')) {
    const idx = line.indexOf('=');
    if (idx !== -1) fields[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return fields;
}

function readWorkflowVersion(runtimeDir) {
  for (const filename of ['VERSION', '.installed-version']) {
    const versionPath = path.join(runtimeDir, filename);
    if (fs.existsSync(versionPath)) {
      return fs.readFileSync(versionPath, 'utf8').trim() || 'unknown';
    }
  }
  return 'unknown';
}

function checkShellLaunchers(homeDir) {
  const shellChecks = buildShellChecks(homeDir);
  const powershellChecks = buildPowerShellChecks(homeDir);
  const shellInstalled = shellChecks.every((item) => item.ok);
  const powershellInstalled = powershellChecks.every((item) => item.ok);
  return {
    installed: shellInstalled || powershellInstalled,
    shellInstalled,
    powershellInstalled,
    checks: [...shellChecks, ...powershellChecks],
    shellChecks,
    powershellChecks,
  };
}

function buildShellChecks(homeDir) {
  const envZdotdir =
    typeof process.env.ZDOTDIR === 'string' ? process.env.ZDOTDIR.trim() : '';
  return [
    launcherCheck('~/.claude/bin/goldband-self-update', [
      homeDir,
      '.claude',
      'bin',
      'goldband-self-update',
    ]),
    launcherCheck('~/.claude/shell/goldband-launchers.sh', [
      homeDir,
      '.claude',
      'shell',
      'goldband-launchers.sh',
    ]),
    {
      file: zshCheckLabel(envZdotdir),
      ok: hasZshSourceBlock(homeDir, envZdotdir),
    },
  ];
}

function launcherCheck(file, pathParts) {
  return { file, ok: fs.existsSync(path.join(...pathParts)) };
}

function zshCheckLabel(envZdotdir) {
  return envZdotdir.length > 0
    ? `${path.join(envZdotdir, '.zshrc')} (ZDOTDIR) or ~/.zshrc goldband shell launchers block (zsh only)`
    : '~/.zshrc goldband shell launchers block (zsh only)';
}

function hasZshSourceBlock(homeDir, envZdotdir) {
  const candidates =
    envZdotdir.length > 0 ? [path.join(envZdotdir, '.zshrc')] : [];
  candidates.push(path.join(homeDir, '.zshrc'));
  return [...new Set(candidates)].some((candidate) =>
    fileContainsAll(candidate, [
      '# >>> goldband shell launchers >>>',
      'source "$HOME/.claude/shell/goldband-launchers.sh"',
    ]),
  );
}

function buildPowerShellChecks(homeDir) {
  return [
    launcherCheck('~/.claude/bin/goldband-self-update.ps1', [
      homeDir,
      '.claude',
      'bin',
      'goldband-self-update.ps1',
    ]),
    launcherCheck('~/.claude/shell/goldband-launchers.ps1', [
      homeDir,
      '.claude',
      'shell',
      'goldband-launchers.ps1',
    ]),
    {
      file: '~/Documents/{PowerShell,WindowsPowerShell}/Microsoft.PowerShell_profile.ps1 goldband launcher block (PowerShell only)',
      ok: hasPowerShellSourceBlock(homeDir),
    },
  ];
}

function hasPowerShellSourceBlock(homeDir) {
  return powerShellProfiles(homeDir).some((profilePath) =>
    fileContainsAll(profilePath, [
      '# >>> goldband powershell launchers >>>',
      '. "$HOME/.claude/shell/goldband-launchers.ps1"',
    ]),
  );
}

function powerShellProfiles(homeDir) {
  return [
    path.join(
      homeDir,
      'Documents',
      'PowerShell',
      'Microsoft.PowerShell_profile.ps1',
    ),
    path.join(
      homeDir,
      'Documents',
      'WindowsPowerShell',
      'Microsoft.PowerShell_profile.ps1',
    ),
  ];
}

function fileContainsAll(filePath, fragments) {
  if (!fs.existsSync(filePath)) return false;
  const raw = fs.readFileSync(filePath, 'utf8');
  return fragments.every((fragment) => raw.includes(fragment));
}

function checkWorkflowInstall(homeDir) {
  const result = emptyWorkflowResult();
  checkClaudeWorkflow(homeDir, result);
  checkCodexWorkflow(homeDir, result);
  checkWorkflowState(homeDir, result);
  checkGoldbandWorkflowOverlap(homeDir, result);
  return result;
}

function emptyWorkflowResult() {
  return {
    claudeInstalled: false,
    claudeVersion: null,
    claudeChecks: [],
    codexInstalled: false,
    codexVersion: null,
    codexChecks: [],
    stateInstalled: false,
    stateChecks: [],
    warnings: [],
  };
}

function checkClaudeWorkflow(homeDir, result) {
  const claudeDir = path.join(homeDir, '.claude', 'skills', 'workflow');
  if (!fs.existsSync(claudeDir)) return;
  result.claudeInstalled = true;
  result.claudeVersion = readWorkflowVersion(claudeDir);
  result.claudeChecks = [
    'setup',
    path.join('bin', 'workflow-repo-mode'),
    path.join('careful', 'SKILL.md'),
    path.join('freeze', 'SKILL.md'),
    path.join('review', 'SKILL.md'),
    path.join('qa', 'SKILL.md'),
  ].map((relativePath) => ({
    file: relativePath,
    ok: fs.existsSync(path.join(claudeDir, relativePath)),
  }));
}

function checkCodexWorkflow(homeDir, result) {
  const codexDir = path.join(homeDir, '.codex', 'skills', 'workflow');
  if (!fs.existsSync(codexDir)) return;
  result.codexInstalled = true;
  result.codexVersion = readWorkflowVersion(codexDir);
  result.codexChecks.push(...codexRuntimeChecks(homeDir, codexDir));
}

function codexRuntimeChecks(homeDir, codexDir) {
  const required = [
    path.join('bin', 'workflow-config'),
    path.join('review', 'checklist.md'),
  ].map((relativePath) => ({
    file: relativePath,
    ok: fs.existsSync(path.join(codexDir, relativePath)),
  }));
  return [...required, generatedCodexSkillCheck(homeDir)];
}

function generatedCodexSkillCheck(homeDir) {
  const codexSkillsRoot = path.join(homeDir, '.codex', 'skills');
  const generatedSkills = fs.existsSync(codexSkillsRoot)
    ? fs.readdirSync(codexSkillsRoot).filter((name) => /^goldband-/.test(name))
    : [];
  return {
    file: '~/.codex/skills/goldband-*',
    ok: generatedSkills.length > 0,
    detail: `${generatedSkills.length} generated skills`,
  };
}

function checkWorkflowState(homeDir, result) {
  const stateDir = path.join(homeDir, '.workflow');
  if (!fs.existsSync(stateDir)) return;
  result.stateInstalled = true;
  result.stateChecks = ['projects'].map((relativePath) => ({
    file: relativePath,
    ok: fs.existsSync(path.join(stateDir, relativePath)),
  }));
}

function checkGoldbandWorkflowOverlap(homeDir, result) {
  const profile = readProfileFile(
    path.join(homeDir, '.claude', 'skills', '.goldband-profile'),
  );
  if (!result.claudeInstalled || !profile) return;
  const installedSkills = String(profile.skills || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (hasSafetyOverlap(installedSkills)) {
    result.warnings.push(
      'goldband careful-mode/freeze-mode and workflow safety skills are both available; use goldband for hard global guardrails, workflow skills for task-local guardrails.',
    );
  }
}

function hasSafetyOverlap(installedSkills) {
  return (
    installedSkills.includes('careful-mode') ||
    installedSkills.includes('freeze-mode')
  );
}

module.exports = {
  checkHookReferences,
  checkShellLaunchers,
  checkWorkflowInstall,
};
