import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function assertInstalledManagedWorktreeSurface(home) {
  for (const host of ['.claude', '.codex']) {
    const binary = path.join(
      home,
      host,
      'skills',
      'goldband',
      'bin',
      'goldband',
    );
    const result = spawnSync(binary, ['--help'], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /goldband worktree create <name>/);
    assert.match(result.stdout, /goldband worktree finish <name>/);
  }

  const launcher = fs.readFileSync(
    path.join(home, '.claude', 'shell', 'goldband-launchers.sh'),
    'utf8',
  );
  assert.match(launcher, /^goldband\(\) \{/m);
  assert.match(launcher, /\.codex\/skills\/goldband\/bin\/goldband/);
  assert.match(launcher, /\.claude\/skills\/goldband\/bin\/goldband/);
}
