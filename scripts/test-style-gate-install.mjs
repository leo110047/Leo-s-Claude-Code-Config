import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = process.cwd();

const tests = [
  [
    'style gate installs materialized hooks outside the source checkout',
    testMaterializedInstall,
  ],
  [
    'style gate migrates the legacy source checkout hooksPath',
    testLegacySourcePathMigration,
  ],
  [
    'uninstall removes only Goldband-owned hooks',
    testUninstallPreservesForeignHooks,
  ],
  [
    'uninstall removes owned hooks after hooksPath changes',
    testUninstallAfterHooksPathChanges,
  ],
  [
    'uninstall recognizes owned hooks after the source checkout moves',
    testUninstallAfterSourceMoves,
  ],
  [
    'uninstall preserves a modified managed hook',
    testUninstallPreservesModifiedManagedHook,
  ],
];

for (const [name, test] of tests) {
  test();
  console.log(`ok - ${name}`);
}

function testMaterializedInstall() {
  const fixture = createInstallerFixture();
  const result = installStyleGate(fixture);
  assertEqual(result.status, 0, result.stdout + result.stderr);

  const installedHooks = path.join(
    fixture.home,
    '.config',
    'goldband',
    'git-hooks',
  );
  assertEqual(globalHooksPath(fixture.home), installedHooks);
  assertFile(path.join(installedHooks, 'pre-commit'));
  assertFile(path.join(installedHooks, 'commit-msg'));
  assertFile(path.join(installedHooks, 'lib', 'project-hook.sh'));
  const ownershipRecord = fs
    .readFileSync(path.join(installedHooks, '.goldband-source'), 'utf8')
    .split('\n');
  assertEqual(ownershipRecord[0], fixture.root);
  assertEqual(ownershipRecord[1], 'schemaVersion=1');
  assertIncludes(ownershipRecord.join('\n'), 'file\tpre-commit\t');
  assertIncludes(ownershipRecord.join('\n'), 'file\tcommit-msg\t');
  assertIncludes(ownershipRecord.join('\n'), 'file\tlib/project-hook.sh\t');
  assertEqual(
    fs.existsSync(path.join(fixture.root, 'git-hooks', 'post-checkout')),
    false,
  );
}

function testLegacySourcePathMigration() {
  const fixture = createInstallerFixture();
  const legacyLfsHook = path.join(fixture.root, 'git-hooks', 'post-checkout');
  fs.writeFileSync(legacyLfsHook, '#!/bin/sh\ngit lfs post-checkout "$@"\n');
  fs.chmodSync(legacyLfsHook, 0o755);
  run(
    'git',
    [
      'config',
      '--global',
      'core.hooksPath',
      path.join(fixture.root, 'git-hooks'),
    ],
    { env: fixtureEnv(fixture.home) },
  );

  const result = installStyleGate(fixture);
  assertEqual(result.status, 0, result.stdout + result.stderr);
  assertEqual(
    globalHooksPath(fixture.home),
    path.join(fixture.home, '.config', 'goldband', 'git-hooks'),
  );
  assertIncludes(result.stdout, '遷移');
  assertEqual(
    fs.readFileSync(
      path.join(
        fixture.home,
        '.config',
        'goldband',
        'git-hooks',
        'post-checkout',
      ),
      'utf8',
    ),
    fs.readFileSync(legacyLfsHook, 'utf8'),
  );
}

function testUninstallPreservesForeignHooks() {
  const fixture = createInstallerFixture();
  const install = installStyleGate(fixture);
  assertEqual(install.status, 0, install.stdout + install.stderr);

  const installedHooks = path.join(
    fixture.home,
    '.config',
    'goldband',
    'git-hooks',
  );
  const foreignHook = path.join(installedHooks, 'pre-push');
  fs.writeFileSync(foreignHook, '#!/bin/sh\ngit lfs pre-push "$@"\n');
  fs.chmodSync(foreignHook, 0o755);

  const result = run(
    'bash',
    [path.join(fixture.root, 'install.sh'), 'uninstall'],
    {
      cwd: fixture.root,
      env: fixtureEnv(fixture.home),
    },
  );
  assertEqual(result.status, 0, result.stdout + result.stderr);
  assertEqual(globalHooksPath(fixture.home), '');
  assertEqual(fs.existsSync(path.join(installedHooks, 'pre-commit')), false);
  assertEqual(fs.existsSync(path.join(installedHooks, 'commit-msg')), false);
  assertFile(foreignHook);
}

function testUninstallAfterHooksPathChanges() {
  const fixture = createInstallerFixture();
  const install = installStyleGate(fixture);
  assertEqual(install.status, 0, install.stdout + install.stderr);

  const installedHooks = path.join(
    fixture.home,
    '.config',
    'goldband',
    'git-hooks',
  );
  const foreignHook = path.join(installedHooks, 'pre-push');
  const replacementHooks = path.join(fixture.home, 'replacement-hooks');
  fs.writeFileSync(foreignHook, '#!/bin/sh\ngit lfs pre-push "$@"\n');
  fs.mkdirSync(replacementHooks);
  run('git', ['config', '--global', 'core.hooksPath', replacementHooks], {
    env: fixtureEnv(fixture.home),
  });

  const result = run(
    'bash',
    [path.join(fixture.root, 'install.sh'), 'uninstall'],
    {
      cwd: fixture.root,
      env: fixtureEnv(fixture.home),
    },
  );
  assertEqual(result.status, 0, result.stdout + result.stderr);
  assertEqual(globalHooksPath(fixture.home), replacementHooks);
  assertEqual(fs.existsSync(path.join(installedHooks, 'pre-commit')), false);
  assertEqual(fs.existsSync(path.join(installedHooks, 'commit-msg')), false);
  assertFile(foreignHook);
}

function testUninstallAfterSourceMoves() {
  const fixture = createInstallerFixture();
  const install = installStyleGate(fixture);
  assertEqual(install.status, 0, install.stdout + install.stderr);

  const installedHooks = path.join(
    fixture.home,
    '.config',
    'goldband',
    'git-hooks',
  );
  const foreignHook = path.join(installedHooks, 'pre-push');
  const movedRoot = `${fixture.root}-moved`;
  fs.writeFileSync(foreignHook, '#!/bin/sh\ngit lfs pre-push "$@"\n');
  fs.renameSync(fixture.root, movedRoot);

  const result = run(
    'bash',
    [path.join(movedRoot, 'install.sh'), 'uninstall'],
    {
      cwd: movedRoot,
      env: fixtureEnv(fixture.home),
    },
  );
  assertEqual(result.status, 0, result.stdout + result.stderr);
  assertEqual(globalHooksPath(fixture.home), '');
  assertEqual(fs.existsSync(path.join(installedHooks, 'pre-commit')), false);
  assertEqual(fs.existsSync(path.join(installedHooks, 'commit-msg')), false);
  assertFile(foreignHook);
}

function testUninstallPreservesModifiedManagedHook() {
  const fixture = createInstallerFixture();
  const install = installStyleGate(fixture);
  assertEqual(install.status, 0, install.stdout + install.stderr);

  const installedHooks = path.join(
    fixture.home,
    '.config',
    'goldband',
    'git-hooks',
  );
  const modifiedHook = path.join(installedHooks, 'pre-commit');
  fs.appendFileSync(modifiedHook, '\n# locally modified\n');

  const result = run(
    'bash',
    [path.join(fixture.root, 'install.sh'), 'uninstall'],
    {
      cwd: fixture.root,
      env: fixtureEnv(fixture.home),
    },
  );
  assertEqual(result.status, 0, result.stdout + result.stderr);
  assertEqual(globalHooksPath(fixture.home), '');
  assertFile(modifiedHook);
  assertEqual(fs.existsSync(path.join(installedHooks, 'commit-msg')), false);
  assertIncludes(result.stdout, 'installed hook 已修改');
}

function createInstallerFixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'goldband-style-installer-'),
  );
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-style-home-'));
  fs.copyFileSync(
    path.join(repoRoot, 'install.sh'),
    path.join(root, 'install.sh'),
  );
  fs.cpSync(path.join(repoRoot, 'shell'), path.join(root, 'shell'), {
    recursive: true,
  });
  fs.cpSync(path.join(repoRoot, 'git-hooks'), path.join(root, 'git-hooks'), {
    recursive: true,
    filter: (source) =>
      !['post-checkout', 'post-commit', 'post-merge', 'pre-push'].includes(
        path.basename(source),
      ),
  });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.copyFileSync(
    path.join(repoRoot, 'scripts', 'check-goldband-project-style-gate.mjs'),
    path.join(root, 'scripts', 'check-goldband-project-style-gate.mjs'),
  );
  return { root, home };
}

function installStyleGate(fixture) {
  return run('bash', [path.join(fixture.root, 'install.sh'), 'style-gate'], {
    cwd: fixture.root,
    env: fixtureEnv(fixture.home),
  });
}

function globalHooksPath(home) {
  return run('git', ['config', '--global', '--get', 'core.hooksPath'], {
    env: fixtureEnv(home),
  }).stdout.trim();
}

function fixtureEnv(home) {
  return {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
  };
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    env: options.env ?? process.env,
  });
}

function assertFile(file) {
  if (fs.statSync(file).isFile()) return;
  throw new Error(`expected regular file: ${file}`);
}

function assertEqual(actual, expected, message = '') {
  if (actual === expected) return;
  throw new Error(`expected ${expected}, got ${actual}\n${message}`);
}

function assertIncludes(value, expected) {
  if (value.includes(expected)) return;
  throw new Error(`expected output to include ${expected}\n${value}`);
}
