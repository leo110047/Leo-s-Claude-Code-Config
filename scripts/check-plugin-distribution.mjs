#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  diffArtifacts,
  EXPECTED_ASSETS_PATH,
  PLUGIN_HOOKS_PATH,
  PLUGIN_ROOT_PATH,
  ROOT_DIR,
  readExpectedAssets,
} from './lib/plugin-distribution.mjs';
import { summarizeHooks } from './lib/plugin-hook-summary.mjs';

function main() {
  const skipCli = process.argv.includes('--skip-cli');
  assert.deepEqual(
    diffArtifacts(),
    [],
    'plugin generated artifacts are out of date',
  );
  const expected = readExpectedAssets();
  assertExpectedFilesExist(expected);
  assertPluginHookCommandsArePortable();
  assertPluginPackageShape(PLUGIN_ROOT_PATH, expected);
  if (!skipCli) {
    assertTempHomePluginInstall(expected);
  }
  console.log('[OK] plugin distribution check passed');
}

function assertExpectedFilesExist(expected) {
  assert.equal(expected.schemaVersion, 1);
  const requiredPaths = [
    expected.plugin.manifest,
    expected.plugin.marketplaceManifest,
    expected.claude.generatedRuleSkill,
    ...expected.claude.commands,
    ...expected.claude.rules,
    ...expected.claude.hookScripts,
    ...expected.claude.runtimeDependencies,
  ];
  for (const relative of requiredPaths) {
    assert.ok(
      fs.existsSync(path.join(ROOT_DIR, relative)),
      `missing expected asset: ${relative}`,
    );
  }
  assert.ok(
    fs.existsSync(EXPECTED_ASSETS_PATH),
    'expected asset list is missing',
  );
}

function assertPluginHookCommandsArePortable() {
  const content = fs.readFileSync(PLUGIN_HOOKS_PATH, 'utf8');
  assert.ok(
    content.includes('${CLAUDE_PLUGIN_ROOT}/hooks'),
    'plugin hooks must resolve bundled hook scripts via CLAUDE_PLUGIN_ROOT',
  );
  assert.equal(
    content.includes('${HOOKS_DIR}'),
    false,
    'plugin hooks still contain HOOKS_DIR',
  );
  assert.equal(
    content.includes('${CLAUDE_DIR}'),
    false,
    'plugin hooks still contain CLAUDE_DIR',
  );
}

function assertTempHomePluginInstall(expected) {
  const tmpHome = fs.mkdtempSync(
    path.join(os.tmpdir(), 'goldband-plugin-home.'),
  );
  try {
    runClaude(tmpHome, ['plugin', 'validate', '.']);
    runClaude(tmpHome, ['plugin', 'marketplace', 'add', './']);
    runClaude(tmpHome, [
      'plugin',
      'install',
      `${expected.plugin.name}@${expected.plugin.marketplace}`,
      '--scope',
      'user',
    ]);
    const list = runClaude(tmpHome, ['plugin', 'list', '--json']);
    const installed = findInstalledPlugin(JSON.parse(list.stdout), expected);
    assert.equal(
      installed.errors,
      undefined,
      `installed plugin reported errors: ${JSON.stringify(installed.errors)}`,
    );
    assertInstalledAssets(installed.installPath, expected);
    assertPluginPackageShape(installed.installPath, expected);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
}

function assertPluginPackageShape(pluginRootPath, expected) {
  assertInstalledAssets(pluginRootPath, expected);
  assertInstalledRuntimeExecutes(pluginRootPath);
  assertNoHeavyRuntime(pluginRootPath);
}

function runClaude(tmpHome, args) {
  const result = spawnSync('claude', args, {
    cwd: ROOT_DIR,
    env: { ...process.env, HOME: tmpHome },
    encoding: 'utf8',
  });
  if (result.status === 0) {
    return result;
  }
  throw new Error(
    [
      `claude ${args.join(' ')} failed in temp HOME`,
      result.stdout.trim(),
      result.stderr.trim(),
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

function findInstalledPlugin(installedPlugins, expected) {
  const pluginId = `${expected.plugin.name}@${expected.plugin.marketplace}`;
  const installed = installedPlugins.find((plugin) => plugin.id === pluginId);
  assert.ok(installed, `plugin not installed: ${pluginId}`);
  assert.ok(installed.installPath, `plugin installPath missing: ${pluginId}`);
  return installed;
}

function assertInstalledAssets(installPath, expected) {
  assertCommandAssets(installPath, expected);
  assertSkillAssets(installPath, expected);
  assertHookAssets(installPath, expected);
  assertRuntimeDependencies(installPath, expected);
  assertGoldbandLanguageCommandIsPluginSafe(installPath);
}

function assertCommandAssets(installPath, expected) {
  for (const commandPath of expected.claude.commands) {
    assert.ok(
      fs.existsSync(path.join(installPath, commandPath)),
      `installed command missing: ${commandPath}`,
    );
  }
}

function assertSkillAssets(installPath, expected) {
  const actualSkills = fs
    .readdirSync(path.join(installPath, 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) =>
      fs.existsSync(path.join(installPath, 'skills', entry.name, 'SKILL.md')),
    )
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(actualSkills, [...expected.claude.skills].sort());
}

function assertHookAssets(installPath, expected) {
  const hooksFile = path.join(installPath, 'hooks', 'hooks.json');
  assert.ok(fs.existsSync(hooksFile), 'installed plugin hooks file missing');
  const hooks = JSON.parse(fs.readFileSync(hooksFile, 'utf8')).hooks;
  assert.deepEqual(summarizeHooks(hooks), expected.claude.hooks);
  for (const hookScript of expected.claude.hookScripts) {
    assert.ok(
      fs.existsSync(path.join(installPath, hookScript)),
      `installed hook script missing: ${hookScript}`,
    );
  }
}

function assertRuntimeDependencies(installPath, expected) {
  for (const runtimeDependency of expected.claude.runtimeDependencies) {
    assert.ok(
      fs.existsSync(path.join(installPath, runtimeDependency)),
      `installed runtime dependency missing: ${runtimeDependency}`,
    );
  }
}

function assertGoldbandLanguageCommandIsPluginSafe(installPath) {
  const commandPath = path.join(
    installPath,
    'commands',
    'goldband-language.md',
  );
  const content = fs.readFileSync(commandPath, 'utf8');
  assert.equal(
    content.includes('~/.claude/commands/scripts/set-goldband-language.sh set'),
    false,
    'goldband-language command must not hardcode installer command helper path',
  );
  assert.ok(
    content.includes(
      '${CLAUDE_PLUGIN_ROOT}/commands/scripts/set-goldband-language.sh',
    ),
    'goldband-language command must describe the plugin-bundled helper path',
  );
}

function assertNoHeavyRuntime(installPath) {
  const matches = findNamedDirectories(installPath, 'goldband-loop');
  assert.deepEqual(matches, [], 'plugin cache must not contain goldband-loop');
}

function assertInstalledRuntimeExecutes(installPath) {
  runNodeHook(installPath, 'hooks/scripts/hooks/hook-router.js', {});
  runNodeHook(installPath, 'hooks/scripts/hooks/hook-router.js', {
    hook_event_name: 'Stop',
    session_id: 'plugin-runtime-test',
  });
  const suggestions = runNodeHook(
    installPath,
    'hooks/scripts/hooks/skill-activation-suggestions.js',
    {
      hook_event_name: 'UserPromptSubmit',
      prompt: 'hello',
      session_id: 'plugin-runtime-test',
    },
  );
  assert.doesNotThrow(() => JSON.parse(suggestions.stdout || '{}'));
  assert.equal(
    suggestions.stdout.includes('Cross-review gate armed'),
    false,
    'skill activation hook must not report cross-review armed when runtime is absent',
  );
}

function runNodeHook(installPath, relativeScriptPath, input) {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'goldband-plugin-runtime-data.'),
  );
  try {
    const result = spawnSync(
      process.execPath,
      [path.join(installPath, relativeScriptPath)],
      {
        cwd: installPath,
        env: {
          ...process.env,
          CLAUDE_PLUGIN_ROOT: installPath,
          GOLDBAND_DATA_DIR: dataDir,
        },
        input: `${JSON.stringify(input)}\n`,
        encoding: 'utf8',
      },
    );
    assert.equal(
      result.status,
      0,
      [
        `plugin runtime failed: ${relativeScriptPath}`,
        result.stdout.trim(),
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join('\n'),
    );
    return result;
  } finally {
    fs.rmSync(dataDir, { force: true, recursive: true });
  }
}

function findNamedDirectories(rootDir, name) {
  const matches = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const entryPath = path.join(rootDir, entry.name);
    if (!entry.isDirectory()) {
      continue;
    }
    if (entry.name === name) {
      matches.push(entryPath);
    }
    matches.push(...findNamedDirectories(entryPath, name));
  }
  return matches;
}

main();
