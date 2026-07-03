#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  copyRepoSubset,
  createFakeWorkflow,
  mktemp,
  run,
  writeFakeGitScript,
} from './lib/windows-platform-test-fixtures.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

function readProfile(profilePath) {
  const raw = fs.readFileSync(profilePath, 'utf8');
  return Object.fromEntries(
    raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

function installArgs(repoDir, homeDir, ...actions) {
  return [
    path.join(repoDir, 'scripts', 'goldband-windows.mjs'),
    'install',
    ...actions,
    '--platform',
    'win32',
    '--home',
    homeDir,
    '--repo',
    repoDir,
  ];
}

function syncArgs(repoDir, homeDir, ...extraArgs) {
  return [
    path.join(repoDir, 'scripts', 'goldband-windows.mjs'),
    'sync-skills',
    '--platform',
    'win32',
    '--home',
    homeDir,
    '--repo',
    repoDir,
    ...extraArgs,
  ];
}

function statusArgs(repoDir, homeDir, ...extraArgs) {
  return [
    path.join(repoDir, 'scripts', 'goldband-windows.mjs'),
    'status',
    '--platform',
    'win32',
    '--home',
    homeDir,
    '--repo',
    repoDir,
    ...extraArgs,
  ];
}

function selfUpdateArgs(repoDir, homeDir, ...extraArgs) {
  return [
    path.join(repoDir, 'scripts', 'goldband-windows.mjs'),
    'self-update',
    '--platform',
    'win32',
    '--home',
    homeDir,
    '--repo',
    repoDir,
    ...extraArgs,
  ];
}

function uninstallArgs(repoDir, homeDir, ...extraArgs) {
  return [
    path.join(repoDir, 'scripts', 'goldband-windows.mjs'),
    'uninstall',
    '--platform',
    'win32',
    '--home',
    homeDir,
    '--repo',
    repoDir,
    ...extraArgs,
  ];
}

function main() {
  const context = createTestContext();
  try {
    setupFixtureRepo(context);
    const externalRequirementsPath = allToolsScenario(context);
    refreshCopyScenario(context);
    workflowScenario(context);
    syncSkillsScenario(context);
    statusScenario(context);
    selfUpdateGuardrailScenario(context);
    selfUpdateScenario(context);
    uninstallScenario(context, externalRequirementsPath);
    userOwnedGuidanceScenario(context);
    console.log('[OK] windows platform integration smoke test passed');
  } finally {
    cleanupContext(context);
  }
}

function createTestContext() {
  return {
    tmpHome: mktemp('goldband-win-home.'),
    tmpRoot: mktemp('goldband-win-root.'),
    tmpOrigin: mktemp('goldband-win-origin.'),
    tmpSeed: mktemp('goldband-win-seed.'),
    tmpWork: mktemp('goldband-win-work.'),
  };
}

function setupFixtureRepo(context) {
  copyRepoSubset(ROOT_DIR, context.tmpRoot);
  createFakeWorkflow(context.tmpRoot);
}

function allToolsScenario(context) {
  const { tmpHome, tmpRoot } = context;
  console.log('[1/7] windows-mode all-tools');
  seedSignedPowerShellProfile(tmpHome);
  run(process.execPath, installArgs(tmpRoot, tmpHome, 'all-tools'), copyEnv());
  run(
    process.execPath,
    installArgs(tmpRoot, tmpHome, 'codex-requirements'),
    copyEnv(),
  );
  assertInstalledProfiles(tmpHome);
  const externalRequirementsPath = seedExternalRequirements(tmpHome);
  assertInstalledArtifacts(tmpHome, tmpRoot);
  assertRetiredPermissionsRemoved(tmpHome, tmpRoot);
  return externalRequirementsPath;
}

function seedSignedPowerShellProfile(tmpHome) {
  const profilePath = powershellProfilePath(tmpHome);
  fs.mkdirSync(path.dirname(profilePath), { recursive: true });
  fs.writeFileSync(
    profilePath,
    [
      '$env:GOLDBAND_TEST_PROFILE = "before"',
      '',
      '# SIG # Begin signature block',
      '# fake test signature',
      '# SIG # End signature block',
      '',
    ].join('\n'),
    'utf8',
  );
}

function copyEnv() {
  return { env: { ...process.env, GOLDBAND_TEST_FORCE_FILE_COPY: '1' } };
}

function assertInstalledProfiles(tmpHome) {
  const claudeProfile = readProfile(
    path.join(tmpHome, '.claude', 'skills', '.goldband-profile'),
  );
  const codexProfile = readProfile(
    path.join(tmpHome, '.agents', 'skills', '.goldband-profile'),
  );
  assert.match(claudeProfile.skills, /\bfrontend-design\b/);
  assert.match(codexProfile.skills, /\bfrontend-design\b/);
}

function seedExternalRequirements(tmpHome) {
  const externalRequirementsPath = path.join(
    tmpHome,
    'ProgramData',
    'OpenAI',
    'Codex',
    'requirements.toml',
  );
  fs.mkdirSync(path.dirname(externalRequirementsPath), { recursive: true });
  fs.writeFileSync(
    externalRequirementsPath,
    'admin-owned-policy = true\n',
    'utf8',
  );
  return externalRequirementsPath;
}

function assertInstalledArtifacts(tmpHome, tmpRoot) {
  for (const targetPath of expectedInstalledPaths(tmpHome)) {
    assert.ok(fs.existsSync(targetPath));
  }
  assertInstalledFileMatches(
    path.join(tmpHome, '.codex', 'rules', 'goldband.rules'),
    path.join(tmpRoot, 'codex', 'rules', 'default.rules'),
  );
  assertInstalledFileMatches(
    path.join(tmpHome, '.codex', 'rules', 'default.rules'),
    path.join(tmpRoot, 'codex', 'local', 'rules', 'default.rules'),
  );
  const pwsh7Profile = fs.readFileSync(powershellProfilePath(tmpHome), 'utf8');
  assert.match(pwsh7Profile, /goldband-launchers\.ps1/);
  assert.match(pwsh7Profile, /\$env:GOLDBAND_TEST_PROFILE = "before"/);
  assert.doesNotMatch(pwsh7Profile, /# SIG # Begin signature block/);
  assertCodexHooksUsePowerShellEnv(tmpHome);
}

function assertCodexHooksUsePowerShellEnv(tmpHome) {
  const hooksJson = fs.readFileSync(
    path.join(tmpHome, '.codex', 'hooks.json'),
    'utf8',
  );
  assert.match(hooksJson, /\$env:USERPROFILE/);
  assert.doesNotMatch(hooksJson, /%USERPROFILE%/);
}

function assertInstalledFileMatches(installedPath, sourcePath) {
  assert.equal(
    fs.readFileSync(installedPath, 'utf8'),
    fs.readFileSync(sourcePath, 'utf8'),
  );
}

function expectedInstalledPaths(tmpHome) {
  return [
    path.join(tmpHome, '.claude', 'CLAUDE.md'),
    path.join(tmpHome, '.claude', 'commands'),
    path.join(tmpHome, '.codex', 'AGENTS.md'),
    path.join(tmpHome, '.codex', 'readonly.config.toml'),
    path.join(tmpHome, '.codex', 'release.config.toml'),
    path.join(tmpHome, '.codex', 'auto_review_experiment.config.toml'),
    path.join(tmpHome, '.codex', 'requirements.toml'),
    path.join(tmpHome, '.codex', 'agents', 'reviewer.toml'),
    path.join(tmpHome, '.codex', 'hooks.json'),
    path.join(tmpHome, '.codex', 'hooks', 'hook-router.js'),
    path.join(tmpHome, '.codex', 'rules', 'goldband.rules'),
    path.join(tmpHome, '.codex', 'rules', 'default.rules'),
    path.join(tmpHome, '.claude', 'bin', 'goldband-self-update.ps1'),
    path.join(tmpHome, '.claude', 'shell', 'goldband-launchers.ps1'),
    path.join(tmpHome, '.claude', '.goldband-windows-state.json'),
  ];
}

function powershellProfilePath(tmpHome) {
  return path.join(
    tmpHome,
    'Documents',
    'PowerShell',
    'Microsoft.PowerShell_profile.ps1',
  );
}

function assertRetiredPermissionsRemoved(tmpHome, tmpRoot) {
  const settings = JSON.parse(
    fs.readFileSync(path.join(tmpHome, '.claude', 'settings.json'), 'utf8'),
  );
  const retiredAllow = JSON.parse(
    fs.readFileSync(
      path.join(tmpRoot, 'hooks', 'claude-retired-permission-allow.json'),
      'utf8',
    ),
  );
  for (const retired of retiredAllow) {
    assert.ok(
      !(settings.permissions?.allow ?? []).includes(retired),
      `${retired} should not be installed`,
    );
  }
}

function refreshCopyScenario(context) {
  const { tmpHome, tmpRoot } = context;
  appendRefreshMarkers(tmpRoot);
  run(process.execPath, selfUpdateArgs(tmpRoot, tmpHome), copyEnv());
  assert.match(
    readText(tmpHome, '.codex', 'AGENTS.md'),
    /windows-copy-refresh/,
  );
  assert.match(
    readText(tmpHome, '.codex', 'agents', 'reviewer.toml'),
    /windows-agent-refresh/,
  );
  assert.match(
    readText(tmpHome, '.codex', 'hooks', 'hook-router.js'),
    /windows-hook-refresh/,
  );
}

function appendRefreshMarkers(tmpRoot) {
  fs.appendFileSync(
    path.join(tmpRoot, 'codex', 'AGENTS.md'),
    '\nwindows-copy-refresh\n',
    'utf8',
  );
  fs.appendFileSync(
    path.join(tmpRoot, 'codex', 'agents', 'reviewer.toml'),
    '\n# windows-agent-refresh\n',
    'utf8',
  );
  fs.appendFileSync(
    path.join(tmpRoot, 'codex', 'hooks', 'hook-router.js'),
    '\n// windows-hook-refresh\n',
    'utf8',
  );
}

function readText(root, ...parts) {
  return fs.readFileSync(path.join(root, ...parts), 'utf8');
}

function workflowScenario({ tmpHome, tmpRoot }) {
  console.log('[2/7] windows-mode workflow');
  run(process.execPath, installArgs(tmpRoot, tmpHome, 'all-with-workflow'));
  assert.ok(fs.existsSync(path.join(tmpHome, '.claude', 'skills', 'workflow')));
  assert.ok(fs.existsSync(path.join(tmpHome, '.codex', 'skills', 'workflow')));
  assert.ok(
    fs.existsSync(
      path.join(
        tmpHome,
        '.codex',
        'skills',
        'goldband-investigate',
        'SKILL.md',
      ),
    ),
  );
  assert.match(
    readText(tmpRoot, 'vendor', 'workflow', 'review', 'SKILL.md'),
    /^name: review$/m,
  );
}

function syncSkillsScenario({ tmpHome, tmpRoot }) {
  console.log('[3/7] windows-mode sync-skills');
  const skillDir = path.join(tmpRoot, 'skills', 'global', 'dummy-win-skill');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), dummySkillFile(), 'utf8');
  fs.appendFileSync(
    path.join(tmpRoot, 'shell', 'install', 'skill-catalog.txt'),
    '\ndummy-win-skill|full|full\n',
    'utf8',
  );
  run(process.execPath, syncArgs(tmpRoot, tmpHome));
  assert.ok(
    fs.existsSync(path.join(tmpHome, '.claude', 'skills', 'dummy-win-skill')),
  );
  assert.ok(
    fs.existsSync(path.join(tmpHome, '.agents', 'skills', 'dummy-win-skill')),
  );
}

function dummySkillFile() {
  return [
    '---',
    'name: dummy-win-skill',
    'description: test fixture',
    '---',
    '',
  ].join('\n');
}

function statusScenario({ tmpHome, tmpRoot }) {
  console.log('[4/7] windows-mode status');
  const status = run(process.execPath, statusArgs(tmpRoot, tmpHome));
  assert.match(status.stdout, /Claude CLAUDE\.md: installed/);
  assert.match(status.stdout, /PowerShell launchers: installed/);
  assert.match(status.stdout, /Codex profiles: installed/);
  assert.match(
    status.stdout,
    /Codex requirements: staged \(Windows enforcement path unverified\)/,
  );
  assert.match(status.stdout, /Codex rules: installed/);
  assert.match(status.stdout, /Workflow Claude runtime: installed/);
}

function selfUpdateGuardrailScenario({ tmpHome, tmpRoot }) {
  console.log('[5/7] windows-mode self-update guardrails');
  fs.mkdirSync(path.join(tmpRoot, '.git'), { recursive: true });
  const fakeGitLog = path.join(tmpRoot, 'fake-git.log');
  fs.writeFileSync(fakeGitLog, '', 'utf8');
  const guardrailStart = Date.now();
  runSelfUpdateWithFakeGit(tmpRoot, tmpHome, fakeGitLog);
  const guardrailElapsedMs = Date.now() - guardrailStart;
  assert.ok(
    guardrailElapsedMs < 1200,
    `self-update timeout should stop fetch quickly, got ${guardrailElapsedMs}ms`,
  );
  fs.rmSync(path.join(tmpRoot, '.git'), { recursive: true, force: true });
}

function runSelfUpdateWithFakeGit(tmpRoot, tmpHome, fakeGitLog) {
  const fakeGit = writeFakeGitScript(tmpRoot);
  run(
    process.execPath,
    selfUpdateArgs(
      tmpRoot,
      tmpHome,
      '--git',
      fakeGit,
      '--self-update-timeout',
      '0.2',
    ),
    {
      env: {
        ...process.env,
        GOLDBAND_FAKE_GIT_LOG: fakeGitLog,
        GOLDBAND_FAKE_GIT_SLEEP_MS: '1500',
        GOLDBAND_TEST_FORCE_FILE_COPY: '1',
      },
    },
  );
}

function selfUpdateScenario(context) {
  console.log('[6/7] windows-mode self-update');
  seedOriginRepo(context);
  const oldHead = cloneWorkRepo(context);
  pushNextCommit(context);
  run(
    process.execPath,
    selfUpdateArgs(path.join(context.tmpWork, 'repo'), context.tmpHome),
  );
  const newHead = gitHead(path.join(context.tmpWork, 'repo'));
  assert.notStrictEqual(oldHead, newHead);
}

function seedOriginRepo({ tmpOrigin, tmpSeed }) {
  run('git', [
    'init',
    '--bare',
    '--initial-branch=main',
    path.join(tmpOrigin, 'origin.git'),
  ]);
  run('git', [
    'clone',
    path.join(tmpOrigin, 'origin.git'),
    path.join(tmpSeed, 'repo'),
  ]);
  configureGitUser(path.join(tmpSeed, 'repo'));
  copyRepoSubset(ROOT_DIR, path.join(tmpSeed, 'repo'));
  run('git', ['-C', path.join(tmpSeed, 'repo'), 'add', '.']);
  gitCommitNoHooks(path.join(tmpSeed, 'repo'), ['-m', 'seed']);
  run('git', [
    '-C',
    path.join(tmpSeed, 'repo'),
    'push',
    '-u',
    'origin',
    'main',
  ]);
}

function configureGitUser(repoDir) {
  run('git', ['-C', repoDir, 'config', 'user.name', 'goldband-test']);
  run('git', ['-C', repoDir, 'config', 'user.email', 'goldband@example.com']);
}

function gitCommitNoHooks(repoDir, args) {
  run('git', ['-c', 'core.hooksPath=', '-C', repoDir, 'commit', ...args]);
}

function cloneWorkRepo({ tmpOrigin, tmpWork }) {
  run('git', [
    'clone',
    path.join(tmpOrigin, 'origin.git'),
    path.join(tmpWork, 'repo'),
  ]);
  return gitHead(path.join(tmpWork, 'repo'));
}

function gitHead(repoDir) {
  return run('git', ['-C', repoDir, 'rev-parse', 'HEAD']).stdout.trim();
}

function pushNextCommit({ tmpOrigin, tmpSeed }) {
  const repoNext = path.join(tmpSeed, 'repo-next');
  run('git', ['clone', path.join(tmpOrigin, 'origin.git'), repoNext]);
  configureGitUser(repoNext);
  fs.appendFileSync(
    path.join(repoNext, 'AGENTS.md'),
    '\nwindows-update\n',
    'utf8',
  );
  gitCommitNoHooks(repoNext, ['-am', 'update']);
  run('git', ['-C', repoNext, 'push', 'origin', 'main']);
}

function uninstallScenario({ tmpHome, tmpRoot }, externalRequirementsPath) {
  console.log('[7/7] windows-mode uninstall');
  run(process.execPath, uninstallArgs(tmpRoot, tmpHome));
  for (const targetPath of removedPaths(tmpHome)) {
    assert.ok(!fs.existsSync(targetPath));
  }
  const settings = JSON.parse(
    fs.readFileSync(path.join(tmpHome, '.claude', 'settings.json'), 'utf8'),
  );
  assert.equal(settings.hooks, undefined);
  assert.equal(settings.statusLine, undefined);
  assert.ok(!(settings.permissions?.allow ?? []).includes('Bash(node *)'));
  assert.equal(
    fs.readFileSync(externalRequirementsPath, 'utf8'),
    'admin-owned-policy = true\n',
  );
}

function removedPaths(tmpHome) {
  return [
    path.join(tmpHome, '.claude', '.goldband-windows-state.json'),
    path.join(tmpHome, '.claude', 'CLAUDE.md'),
    path.join(tmpHome, '.claude', 'bin', 'goldband-self-update.ps1'),
    path.join(tmpHome, '.claude', 'shell', 'goldband-launchers.ps1'),
    path.join(tmpHome, '.codex', 'requirements.toml'),
  ];
}

function userOwnedGuidanceScenario({ tmpRoot }) {
  const userOwnedClaudeHome = mktemp('goldband-win-user-claude.');
  try {
    fs.mkdirSync(path.join(userOwnedClaudeHome, '.claude'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(userOwnedClaudeHome, '.claude', 'CLAUDE.md'),
      'user-owned claude guidance\n',
      'utf8',
    );
    run(process.execPath, uninstallArgs(tmpRoot, userOwnedClaudeHome));
    assert.equal(
      fs.readFileSync(
        path.join(userOwnedClaudeHome, '.claude', 'CLAUDE.md'),
        'utf8',
      ),
      'user-owned claude guidance\n',
    );
  } finally {
    fs.rmSync(userOwnedClaudeHome, { recursive: true, force: true });
  }
}

function cleanupContext(context) {
  for (const dir of Object.values(context)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main();
