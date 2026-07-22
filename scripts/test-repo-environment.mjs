#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BOOTSTRAP_STEPS } from './bootstrap-repo-tests.mjs';
import {
  inspectRepoTestEnvironment,
  listLegacyHostSkillArtifacts,
  minimumBunVersion,
  parseRetiredWorkflowEntryInventory,
  removeLegacyHostSkillArtifacts,
  versionAtLeast,
} from './lib/repo-test-environment.mjs';

assert.equal(versionAtLeast('1.3.11', '1.3.11'), true);
assert.equal(versionAtLeast('1.4.0', '1.3.11'), true);
assert.equal(versionAtLeast('1.2.21', '1.3.11'), false);
assert.equal(versionAtLeast('invalid', '1.3.11'), false);
assert.deepEqual(parseRetiredWorkflowEntryInventory('review\nqa\n'), [
  'review',
  'qa',
]);
assert.throws(
  () => parseRetiredWorkflowEntryInventory('review\n../custom\n'),
  /invalid retired workflow entry name/,
);
assert.throws(
  () => parseRetiredWorkflowEntryInventory('review\nreview\n'),
  /duplicate retired workflow entry name/,
);

const root = path.resolve(import.meta.dirname, '..');
const fixture = fs.mkdtempSync(
  path.join(os.tmpdir(), 'goldband-repo-test-env-'),
);
try {
  writePackageFixture(fixture);
  writeDependencyMarkers(fixture);
  assert.deepEqual(
    inspectRepoTestEnvironment(fixture, { bunVersion: '1.3.11' }),
    [],
  );

  const retired = path.join(
    fixture,
    'goldband-loop',
    '.agents',
    'skills',
    'goldband-review',
  );
  const rootSkill = path.join(
    fixture,
    'goldband-loop',
    '.agents',
    'skills',
    'goldband',
  );
  const external = path.join(
    fixture,
    'goldband-loop',
    '.agents',
    'skills',
    'external-tool',
  );
  const custom = path.join(
    fixture,
    'goldband-loop',
    '.agents',
    'skills',
    'goldband-custom',
  );
  const managedCustom = path.join(
    fixture,
    'goldband-loop',
    '.agents',
    'skills',
    'goldband-managed-custom',
  );
  const customSymlink = path.join(
    fixture,
    'goldband-loop',
    '.agents',
    'skills',
    'goldband-custom-symlink',
  );
  for (const directory of [
    retired,
    rootSkill,
    external,
    custom,
    managedCustom,
  ]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  fs.writeFileSync(
    path.join(managedCustom, '.goldband-managed-skill'),
    'source=/fixture/goldband-loop/review\n',
  );
  fs.symlinkSync(external, customSymlink);
  assert.deepEqual(listLegacyHostSkillArtifacts(fixture), [
    'goldband-loop/.agents/skills/goldband-managed-custom',
    'goldband-loop/.agents/skills/goldband-review',
  ]);
  assert.deepEqual(removeLegacyHostSkillArtifacts(fixture), [
    'goldband-loop/.agents/skills/goldband-managed-custom',
    'goldband-loop/.agents/skills/goldband-review',
  ]);
  assert.equal(fs.existsSync(retired), false);
  assert.equal(fs.existsSync(rootSkill), true);
  assert.equal(fs.existsSync(external), true);
  assert.equal(fs.existsSync(custom), true);
  assert.equal(fs.lstatSync(customSymlink).isSymbolicLink(), true);
  assert.equal(fs.existsSync(managedCustom), false);

  fs.rmSync(path.join(fixture, 'mcp', 'server', 'node_modules'), {
    recursive: true,
    force: true,
  });
  const problems = inspectRepoTestEnvironment(fixture, {
    bunVersion: '1.2.21',
  });
  assert.deepEqual(
    problems.map((problem) => problem.code),
    ['mcp-dependencies-missing', 'bun-too-old'],
  );
  assert.match(
    problems[1].message,
    /Bun >=1\.3\.11 is required; found 1\.2\.21/,
  );
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}

assertInvalidSetupDoesNotMutate(root);

assert.equal(minimumBunVersion(root), '1.3.11');
assert.deepEqual(
  BOOTSTRAP_STEPS.map((step) => [
    step.label,
    path.relative(path.resolve(import.meta.dirname, '..'), step.cwd),
    step.args.join(' '),
  ]),
  [
    ['root Node dependencies', '', 'ci'],
    ['MCP server dependencies', 'mcp/server', 'ci'],
    [
      'Goldband Loop dependencies',
      'goldband-loop',
      'install --frozen-lockfile',
    ],
  ],
);

const loopPackage = JSON.parse(
  fs.readFileSync(path.join(root, 'goldband-loop', 'package.json'), 'utf8'),
);
assert.equal(loopPackage.packageManager, 'bun@1.3.11');
for (const workflow of [
  '.github/workflows/validate.yml',
  '.github/workflows/goldband-loop-windows.yml',
  '.github/workflows/goldband-loop-paid-evals.yml',
]) {
  const contents = fs.readFileSync(path.join(root, workflow), 'utf8');
  for (const match of contents.matchAll(/bun-version:\s*['"]?([^'"\s]+)/g)) {
    assert.equal(match[1], '1.3.11', `${workflow} must pin Bun 1.3.11`);
  }
}
console.log('[OK] repository test environment contract verified');

function writePackageFixture(root) {
  fs.mkdirSync(path.join(root, 'goldband-loop'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'goldband-loop', 'package.json'),
    JSON.stringify({ engines: { bun: '>=1.3.11' } }),
  );
  fs.mkdirSync(path.join(root, 'goldband-loop', 'lib'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'goldband-loop', 'lib', 'retired-workflow-entry-names.txt'),
    'review\nqa\ngoldband-upgrade\n',
  );
}

function writeDependencyMarkers(root) {
  for (const relativePath of [
    'node_modules/.bin/biome',
    'mcp/server/node_modules/.bin/tsc',
    'goldband-loop/node_modules/.bin/tsc',
  ]) {
    const filePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'fixture');
  }
}

function writeInvalidSetupFixture(root, fixture) {
  const loopRoot = path.join(fixture, 'goldband-loop');
  const fakeBin = path.join(fixture, 'bin');
  fs.mkdirSync(fakeBin, { recursive: true });
  writePackageFixture(fixture);
  fs.copyFileSync(
    path.join(root, 'goldband-loop', 'setup'),
    path.join(loopRoot, 'setup'),
  );
  fs.chmodSync(path.join(loopRoot, 'setup'), 0o755);
  fs.writeFileSync(
    path.join(fakeBin, 'bun'),
    '#!/usr/bin/env bash\nprintf "1.3.11\\n"\n',
    { mode: 0o755 },
  );
  return { fakeBin, loopRoot };
}

function assertInvalidSetupDoesNotMutate(root) {
  const fixture = fs.mkdtempSync(
    path.join(os.tmpdir(), 'goldband-invalid-setup-'),
  );
  try {
    const { fakeBin, loopRoot } = writeInvalidSetupFixture(root, fixture);

    const preserved = [
      'goldband',
      'goldband-review',
      'goldband-custom',
      'external-tool',
    ];
    for (const name of preserved) {
      fs.mkdirSync(path.join(loopRoot, '.agents', 'skills', name), {
        recursive: true,
      });
    }

    for (const [args, errorPattern] of [
      [['--host', 'invalid-host'], /Unknown --host value: invalid-host/],
      [
        ['--profile', 'invalid-profile'],
        /Unknown --profile value: invalid-profile/,
      ],
    ]) {
      const result = spawnSync(
        'bash',
        [path.join(loopRoot, 'setup'), ...args],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            HOME: path.join(fixture, 'home'),
            PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ''}`,
          },
        },
      );
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, errorPattern);
      for (const name of preserved) {
        assert.equal(
          fs.existsSync(path.join(loopRoot, '.agents', 'skills', name)),
          true,
          `invalid setup arguments removed ${name}`,
        );
      }
    }
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}
