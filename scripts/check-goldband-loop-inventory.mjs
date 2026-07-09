#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(__filename), '..');
const LOOP_DIR = path.join(ROOT_DIR, 'goldband-loop');
const INVENTORY_PATH = path.join(LOOP_DIR, 'inventory.json');
const GENERATED_RUNTIME_BINARY_SOURCES = new Map([
  ['goldband-global-discover', 'bin/goldband-global-discover.ts'],
]);

function main() {
  const inventory = readJson(INVENTORY_PATH);
  assert.equal(inventory.schema, 1);
  assertSourceSymlinksResolve(LOOP_DIR);
  assertLegacyConfigMigration();
  assertSourceInventory(inventory);

  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-loop-home.'));
  try {
    runInstall(tmpHome, 'workflow');
    runInstall(tmpHome, 'workflow-codex');
    assertInstalledStandardInventory(tmpHome, inventory);
    console.log('[OK] Goldband Loop inventory matches clean install');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }

  const copyHome = fs.mkdtempSync(
    path.join(os.tmpdir(), 'goldband-loop-copy-home.'),
  );
  try {
    runInstall(copyHome, 'workflow', { GOLDBAND_FORCE_COPY: '1' });
    assertInstalledKnowledgeCliRuns(copyHome);
    console.log('[OK] Goldband Loop copy fallback runtime CLI works');
  } finally {
    fs.rmSync(copyHome, { recursive: true, force: true });
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function runInstall(home, target, extraEnv = {}) {
  const result = spawnSync(
    'bash',
    [path.join(ROOT_DIR, 'install.sh'), target],
    {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        HOME: home,
        GOLDBAND_LOOP_DIR: LOOP_DIR,
        GOLDBAND_SKIP_GENERATE: '1',
        GOLDBAND_SKIP_PLAYWRIGHT: '1',
        GOLDBAND_SKIP_COREUTILS: '1',
        ...extraEnv,
      },
      encoding: 'utf8',
    },
  );
  if (result.status !== 0) {
    throw new Error(
      [`install failed: ${target}`, result.stdout.trim(), result.stderr.trim()]
        .filter(Boolean)
        .join('\n'),
    );
  }
}

function assertSourceInventory(inventory) {
  const sourceSkills = fs
    .readdirSync(LOOP_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(LOOP_DIR, entry.name, 'SKILL.md'))
    .filter((skillPath) => fs.existsSync(skillPath))
    .map(readSkillName)
    .sort();
  assertDeepSetEqual('source skills', sourceSkills, inventory.skills);

  assertGeneratedRuntimeSources(inventory);
  const sourceBins = executableFiles(path.join(LOOP_DIR, 'bin')).filter(
    (entry) => !GENERATED_RUNTIME_BINARY_SOURCES.has(entry),
  );
  const expectedSourceBins = inventory.binaries.filter(
    (entry) => !GENERATED_RUNTIME_BINARY_SOURCES.has(entry),
  );
  assertDeepSetEqual('source runtime binaries', sourceBins, expectedSourceBins);
}

function assertGeneratedRuntimeSources(inventory) {
  for (const [binary, sourcePath] of GENERATED_RUNTIME_BINARY_SOURCES) {
    assert.ok(
      inventory.binaries.includes(binary),
      `generated runtime binary missing from inventory: ${binary}`,
    );
    assert.ok(
      fs.existsSync(path.join(LOOP_DIR, sourcePath)),
      `generated runtime binary source missing: ${sourcePath}`,
    );
  }
}

function assertSourceSymlinksResolve(rootDir) {
  const broken = [];
  walkSourceTree(rootDir, (entryPath, entry) => {
    if (!entry.isSymbolicLink()) {
      return;
    }
    if (!fs.existsSync(entryPath)) {
      broken.push(
        `${path.relative(ROOT_DIR, entryPath)} -> ${fs.readlinkSync(entryPath)}`,
      );
    }
  });
  assert.deepEqual(broken, [], 'source tree contains broken symlinks');
}

function walkSourceTree(rootDir, visit) {
  const ignoredDirs = new Set([
    '.agents',
    '.claude',
    '.factory',
    '.git',
    '.opencode',
    'node_modules',
  ]);
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) {
      continue;
    }
    const entryPath = path.join(rootDir, entry.name);
    visit(entryPath, entry);
    if (entry.isDirectory()) {
      walkSourceTree(entryPath, visit);
    }
  }
}

function runGoldbandConfigInHome(tmpHome, args) {
  return spawnSync(path.join(LOOP_DIR, 'bin', 'goldband-config'), args, {
    env: { ...process.env, HOME: tmpHome },
    encoding: 'utf8',
  });
}

function writeLegacyMigrationFixture(tmpHome) {
  const legacyDir = path.join(tmpHome, '.workflow');
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(
    path.join(legacyDir, 'config.yaml'),
    'skill_prefix: true\ntelemetry: anonymous\n',
  );
  fs.mkdirSync(path.join(legacyDir, 'projects', 'demo'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(legacyDir, 'projects', 'demo', 'learnings.jsonl'),
    '{"key":"old"}\n',
  );
  fs.mkdirSync(path.join(legacyDir, 'analytics'), { recursive: true });
  fs.writeFileSync(
    path.join(legacyDir, 'analytics', 'skill-usage.jsonl'),
    '{"skill":"old"}\n',
  );
  return legacyDir;
}

function assertLegacyMigrationResult(tmpHome, result) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'true');
  assert.equal(
    fs.readFileSync(path.join(tmpHome, '.goldband', 'config.yaml'), 'utf8'),
    'skill_prefix: true\ntelemetry: anonymous\n',
  );
  assert.equal(
    fs.readFileSync(
      path.join(tmpHome, '.goldband', 'projects', 'demo', 'learnings.jsonl'),
      'utf8',
    ),
    '{"key":"old"}\n',
  );
  assert.equal(
    fs.readFileSync(
      path.join(tmpHome, '.goldband', 'analytics', 'skill-usage.jsonl'),
      'utf8',
    ),
    '{"skill":"old"}\n',
  );
}

function assertLegacyMigrationSentinel(tmpHome, legacyDir) {
  assert.equal(
    fs.existsSync(path.join(tmpHome, '.goldband', '.legacy-migrated')),
    true,
    'legacy migration should write a sentinel',
  );
  fs.writeFileSync(
    path.join(legacyDir, 'projects', 'demo', 'late.jsonl'),
    '{"key":"late"}\n',
  );
  const second = runGoldbandConfigInHome(tmpHome, ['get', 'skill_prefix']);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.stdout, 'true');
  assert.equal(
    fs.existsSync(
      path.join(tmpHome, '.goldband', 'projects', 'demo', 'late.jsonl'),
    ),
    false,
    'legacy migration should not rescan after sentinel exists',
  );
}

function assertLegacyConfigMigration() {
  const tmpHome = fs.mkdtempSync(
    path.join(os.tmpdir(), 'goldband-config-home.'),
  );
  try {
    const legacyDir = writeLegacyMigrationFixture(tmpHome);
    const result = runGoldbandConfigInHome(tmpHome, ['get', 'skill_prefix']);
    assertLegacyMigrationResult(tmpHome, result);
    assertLegacyMigrationSentinel(tmpHome, legacyDir);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
}

function assertInstalledStandardInventory(home, inventory) {
  const claudeSkillsDir = path.join(home, '.claude', 'skills');
  const codexSkillsDir = path.join(home, '.codex', 'skills');
  const claudeRuntime = path.join(claudeSkillsDir, 'goldband');
  const codexRuntime = path.join(codexSkillsDir, 'goldband');

  assertDeepSetEqual(
    'Claude standard visible skills',
    skillDirectories(claudeSkillsDir),
    ['goldband', 'goldband-upgrade'],
  );
  assertDeepSetEqual(
    'Codex standard visible skills',
    skillDirectories(codexSkillsDir),
    ['goldband', 'goldband-upgrade'],
  );
  assert.ok(
    fs.existsSync(
      path.join(claudeRuntime, 'workflows', 'goldband-review.workflow.md'),
    ),
    'Claude standard workflow document missing',
  );
  assert.ok(
    fs.existsSync(
      path.join(codexRuntime, 'workflows', 'goldband-review.workflow.md'),
    ),
    'Codex standard workflow document missing',
  );
  assert.equal(
    fs
      .readFileSync(
        path.join(home, '.goldband', 'state', 'workflow-profile-claude'),
        'utf8',
      )
      .trim(),
    'standard',
  );
  assert.equal(
    fs
      .readFileSync(
        path.join(home, '.goldband', 'state', 'workflow-profile-codex'),
        'utf8',
      )
      .trim(),
    'standard',
  );
  assertInstalledRuntimeSupportFiles(claudeRuntime, codexRuntime);
  assertNoLegacyCommands(home, inventory);
}

function assertInstalledRuntimeSupportFiles(...runtimeRoots) {
  const requiredFiles = [
    path.join('lib', 'knowledge.ts'),
    path.join('review', 'shared-rubric.md'),
    path.join('review', 'findings-schema.md'),
    path.join('review', 'checklist.md'),
    path.join('review', 'ship-fix-first.md'),
    path.join('review', 'greptile-triage.md'),
  ];
  for (const runtimeRoot of runtimeRoots) {
    for (const relPath of requiredFiles) {
      assert.ok(
        fs.existsSync(path.join(runtimeRoot, relPath)),
        `installed runtime support file missing: ${path.join(runtimeRoot, relPath)}`,
      );
    }
  }
}

function assertInstalledKnowledgeCliRuns(home) {
  const result = spawnSync(
    path.join(
      home,
      '.claude',
      'skills',
      'goldband',
      'bin',
      'goldband-knowledge',
    ),
    ['search', '--domain', 'qa', '--query', 'fixture'],
    {
      cwd: home,
      env: {
        ...process.env,
        HOME: home,
        GOLDBAND_HOME: path.join(home, '.goldband'),
      },
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /KNOWLEDGE:/);
}

function skillDirectories(parent) {
  if (!fs.existsSync(parent)) {
    return [];
  }
  return fs
    .readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .filter((entry) => fs.existsSync(path.join(parent, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();
}

function executableFiles(parent) {
  if (!fs.existsSync(parent)) {
    return [];
  }
  return fs
    .readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isFile() || entry.isSymbolicLink())
    .filter((entry) => isExecutable(path.join(parent, entry.name)))
    .map((entry) => entry.name)
    .sort();
}

function isExecutable(filePath) {
  try {
    return (fs.statSync(filePath).mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function readSkillName(skillPath) {
  const raw = fs.readFileSync(skillPath, 'utf8');
  const match = raw.match(/^name:\s*(\S+)/m);
  if (!match) {
    throw new Error(`missing skill name: ${skillPath}`);
  }
  return match[1];
}

function assertNoLegacyCommands(home, inventory) {
  const commandDir = path.join(home, '.claude', 'commands');
  if (!fs.existsSync(commandDir)) {
    return;
  }
  const installed = fs
    .readdirSync(commandDir)
    .filter((entry) => entry.endsWith('.md'))
    .map((entry) => entry.replace(/\.md$/, ''));
  const legacy = installed.filter((entry) =>
    inventory.forbiddenCommands.includes(entry),
  );
  assert.deepEqual(legacy, [], 'legacy commands should not be installed');
}

function assertDeepSetEqual(label, actual, expected) {
  assert.deepEqual(
    [...actual].sort(),
    [...expected].sort(),
    `${label} mismatch`,
  );
}

main();
