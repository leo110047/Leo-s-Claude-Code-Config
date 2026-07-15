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
  const shellInstalled = shellChecks.every((item) => item.ok);
  return {
    installed: shellInstalled,
    shellInstalled,
    checks: shellChecks,
    shellChecks,
    staleNativeWindowsFiles: staleNativeWindowsLauncherFiles(homeDir),
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

function staleNativeWindowsLauncherFiles(homeDir) {
  return [
    path.join(homeDir, '.claude', 'bin', 'goldband-self-update.ps1'),
    path.join(homeDir, '.claude', 'shell', 'goldband-launchers.ps1'),
    path.join(homeDir, '.claude', '.goldband-windows-state.json'),
  ].filter((candidate) => fs.existsSync(candidate));
}

function fileContainsAll(filePath, fragments) {
  if (!fs.existsSync(filePath)) return false;
  const raw = fs.readFileSync(filePath, 'utf8');
  return fragments.every((fragment) => raw.includes(fragment));
}

function checkWorkflowInstall(homeDir, sourceRoot = process.cwd()) {
  const result = emptyWorkflowResult();
  checkClaudeWorkflow(homeDir, sourceRoot, result);
  checkCodexWorkflow(homeDir, sourceRoot, result);
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

function checkClaudeWorkflow(homeDir, sourceRoot, result) {
  const claudeDir = path.join(homeDir, '.claude', 'skills', 'goldband');
  if (!fs.existsSync(claudeDir)) return;
  result.claudeInstalled = true;
  result.claudeVersion = readWorkflowVersion(claudeDir);
  result.claudeChecks = [
    'SKILL.md',
    path.join('bin', 'goldband-repo-mode'),
    path.join('bin', 'goldband-knowledge'),
    path.join('lib', 'knowledge.ts'),
    path.join('review', 'checklist.md'),
  ].map((relativePath) => ({
    file: relativePath,
    ok: fs.existsSync(path.join(claudeDir, relativePath)),
  }));
  result.claudeChecks.push(
    ...workflowProjectionChecks(claudeDir, 'claude', sourceRoot),
  );
}

function checkCodexWorkflow(homeDir, sourceRoot, result) {
  const codexDir = path.join(homeDir, '.codex', 'skills', 'goldband');
  if (!fs.existsSync(codexDir)) return;
  result.codexInstalled = true;
  result.codexVersion = readWorkflowVersion(codexDir);
  result.codexChecks.push(...codexRuntimeChecks(homeDir, codexDir));
  result.codexChecks.push(
    ...workflowProjectionChecks(codexDir, 'codex', sourceRoot),
  );
}

function workflowProjectionChecks(runtimeDir, host, sourceRoot) {
  const installedSourcePath = path.join(runtimeDir, '.installed-source');
  const installedSource = fs.existsSync(installedSourcePath)
    ? fs.readFileSync(installedSourcePath, 'utf8').trim()
    : '';
  const contractPath = workflowContractInventoryPath(
    installedSource,
    sourceRoot,
  );
  if (!contractPath) return coreWorkflowChecks(runtimeDir);

  let contract;
  try {
    contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  } catch {
    return [{ file: 'generated/capability-actions.json', ok: false }];
  }

  if (!Array.isArray(contract.actions)) {
    return [{ file: 'generated/capability-actions.json', ok: false }];
  }

  return contract.actions
    .filter(
      (entry) =>
        Array.isArray(entry.hostSupport) && entry.hostSupport.includes(host),
    )
    .map((entry) =>
      path.join(
        'workflows',
        String(entry.capability || ''),
        `${String(entry.action || '')}.workflow.md`,
      ),
    )
    .map((relativePath) => ({
      file: relativePath,
      ok: fs.existsSync(path.join(runtimeDir, relativePath)),
    }));
}

function workflowContractInventoryPath(installedSource, sourceRoot) {
  const candidates = [
    installedSource &&
      path.join(installedSource, 'generated', 'capability-actions.json'),
    sourceRoot &&
      path.join(
        sourceRoot,
        'goldband-loop',
        'generated',
        'capability-actions.json',
      ),
    sourceRoot && path.join(sourceRoot, 'generated', 'capability-actions.json'),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function coreWorkflowChecks(runtimeDir) {
  return [
    path.join('workflows', 'investigate', 'code.workflow.md'),
    path.join('workflows', 'review', 'code.workflow.md'),
    path.join('workflows', 'qa', 'app.workflow.md'),
  ].map((relativePath) => ({
    file: relativePath,
    ok: fs.existsSync(path.join(runtimeDir, relativePath)),
  }));
}

function codexRuntimeChecks(homeDir, codexDir) {
  const required = [
    path.join('bin', 'goldband-config'),
    path.join('lib', 'knowledge.ts'),
    path.join('review', 'checklist.md'),
  ].map((relativePath) => ({
    file: relativePath,
    ok: fs.existsSync(path.join(codexDir, relativePath)),
  }));
  return [...required, legacyCodexSkillCheck(homeDir)];
}

function legacyCodexSkillCheck(homeDir) {
  const codexSkillsRoot = path.join(homeDir, '.codex', 'skills');
  const legacySkills = fs.existsSync(codexSkillsRoot)
    ? fs.readdirSync(codexSkillsRoot).filter((name) => /^goldband-/.test(name))
    : [];
  return {
    file: 'legacy top-level ~/.codex/skills/goldband-* entries absent',
    ok: legacySkills.length === 0,
    detail: `${legacySkills.length} legacy entries`,
  };
}

function checkWorkflowState(homeDir, result) {
  const stateDir = path.join(homeDir, '.goldband');
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
      'goldband careful-mode/freeze-mode and Goldband Loop safety workflows are both available; use goldband for hard global guardrails, Goldband Loop safety workflows for task-local guardrails.',
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
