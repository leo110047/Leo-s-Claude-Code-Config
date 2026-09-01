import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const STALE_RUNTIME_FILES = [
  path.join('bin', 'goldband-gbrain-install'),
  path.join('bin', 'goldband-memory-ingest.ts'),
  path.join('bin', 'goldband-brain-context-load.ts'),
  path.join('workflows', 'knowledge', 'setup.workflow.md'),
  path.join('hosts', 'gbrain.ts'),
];
const RETIRED_CONTENT = [
  /\bgbrain\b/i,
  /gbrain[_-]/i,
  /\bgoldband-(?:memory-ingest|brain-context-load|brain-consumer|brain-reader)\b/i,
];

export function assertInstalledGbrainRetirement({ home, rootDir, reinstall }) {
  const runtimeRoots = installedRuntimeRoots(home);
  assertInstalledSurfaceClean(runtimeRoots);
  const userAssets = seedUserOwnedAssets(home);
  seedStaleManagedSurface(runtimeRoots);

  reinstall('workflow');
  reinstall('workflow-codex');

  assertInstalledSurfaceClean(runtimeRoots);
  assertUserOwnedAssetsUnchanged(userAssets);
  assertRetiredHostRejected(home, rootDir, userAssets);
}

function installedRuntimeRoots(home) {
  return [
    path.join(home, '.claude', 'skills', 'goldband'),
    path.join(home, '.codex', 'skills', 'goldband'),
  ];
}

function seedStaleManagedSurface(runtimeRoots) {
  for (const runtimeRoot of runtimeRoots) {
    for (const relativePath of STALE_RUNTIME_FILES) {
      const target = path.join(runtimeRoot, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, 'retired integration fixture\n');
    }
  }
}

function seedUserOwnedAssets(home) {
  const files = new Map([
    [
      path.join(home, '.gbrain', 'config.json'),
      '{"sentinel":"provider-config"}\n',
    ],
    [path.join(home, '.gbrain', 'database', 'owner.txt'), 'user database\n'],
    [
      path.join(home, '.goldband', '.gbrain-errors.jsonl'),
      '{"sentinel":"errors"}\n',
    ],
    [
      path.join(home, '.goldband', '.gbrain-engine-cache.json'),
      '{"sentinel":"cache"}\n',
    ],
    [
      path.join(home, '.claude.json'),
      '{"mcpServers":{"gbrain":{"url":"https://example.invalid"}}}\n',
    ],
    [
      path.join(home, 'supabase-project-receipt.json'),
      '{"sentinel":"remote"}\n',
    ],
  ]);
  for (const [filePath, content] of files) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  return files;
}

function assertUserOwnedAssetsUnchanged(userAssets) {
  for (const [filePath, expected] of userAssets) {
    assert.equal(
      fs.readFileSync(filePath, 'utf8'),
      expected,
      `installer must not modify user-owned provider asset: ${filePath}`,
    );
  }
}

function assertRetiredHostRejected(home, rootDir, userAssets) {
  const result = spawnSync(
    'bash',
    [
      path.join(rootDir, 'goldband-loop', 'setup'),
      '--host',
      'gbrain',
      '--quiet',
    ],
    {
      cwd: rootDir,
      env: {
        ...process.env,
        HOME: home,
        GOLDBAND_SKIP_BUILD: '1',
        GOLDBAND_SKIP_PLAYWRIGHT: '1',
      },
      encoding: 'utf8',
    },
  );
  assert.notEqual(
    result.status,
    0,
    'retired host must not install successfully',
  );
  assert.match(result.stderr, /Unknown --host value/);
  assertUserOwnedAssetsUnchanged(userAssets);
}

function assertInstalledSurfaceClean(runtimeRoots) {
  const violations = [];
  for (const runtimeRoot of runtimeRoots) {
    assert.ok(
      fs.existsSync(runtimeRoot),
      `installed runtime missing: ${runtimeRoot}`,
    );
    walk(runtimeRoot, (entryPath, entry) => {
      if (installedEntryViolatesRetirement(runtimeRoot, entryPath, entry)) {
        violations.push(entryPath);
      }
    });
  }
  assert.deepEqual(
    violations,
    [],
    'clean install and seeded-stale upgrade must not retain retired surface',
  );
}

function installedEntryViolatesRetirement(runtimeRoot, entryPath, entry) {
  const relativePath = path.relative(runtimeRoot, entryPath);
  if (relativePath === path.join('lib', 'retired-workflow-entry-names.txt')) {
    return false;
  }
  if (STALE_RUNTIME_FILES.includes(relativePath)) return true;
  if (path.basename(entryPath).startsWith('goldband-gbrain-')) return true;
  if (!entry.isFile() && !entry.isSymbolicLink()) return false;
  try {
    const content = fs.readFileSync(entryPath, 'utf8');
    return RETIRED_CONTENT.some((pattern) => pattern.test(content));
  } catch {
    return false;
  }
}

function walk(root, visit) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    visit(entryPath, entry);
    if (entry.isDirectory()) walk(entryPath, visit);
  }
}
