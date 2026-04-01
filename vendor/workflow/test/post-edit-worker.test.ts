import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dir, '..', '..', '..');
const WORKER_PATH = path.join(ROOT, 'hooks', 'scripts', 'hooks', 'post-edit-worker.js');

function createFakeNpx(logFile: string): string {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-fake-npx-'));
  const fakeNpx = path.join(binDir, 'npx');
  fs.writeFileSync(
    fakeNpx,
    `#!/bin/sh
echo "$@" >> "${logFile}"
exit 0
`,
    { mode: 0o755 },
  );
  return binDir;
}

function runWorker(args: string[], env: Record<string, string>) {
  return spawnSync(process.execPath, [WORKER_PATH, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
    },
  });
}

describe('post-edit-worker', () => {
  test('debounces repeated format runs for the same file', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-worker-test-'));
    const filePath = path.join(tempDir, 'sample.js');
    const logFile = path.join(tempDir, 'npx.log');
    const stateFile = path.join(tempDir, 'debounce.json');
    const binDir = createFakeNpx(logFile);

    fs.writeFileSync(filePath, 'const x = 1;\n');

    const env = {
      PATH: `${binDir}:${process.env.PATH || ''}`,
      HOOK_ROUTER_DEBOUNCE_FILE: stateFile,
      HOOK_DEBOUNCE_FORMAT_MS: '60000',
    };

    try {
      expect(runWorker(['--task', 'format', '--file', filePath, '--cwd', tempDir], env).status).toBe(0);
      expect(runWorker(['--task', 'format', '--file', filePath, '--cwd', tempDir], env).status).toBe(0);

      const invocations = fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean);
      expect(invocations).toHaveLength(1);
      expect(invocations[0]).toContain('prettier --write');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
      fs.rmSync(binDir, { recursive: true, force: true });
    }
  });

  test('recovers from a stale debounce lock', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-worker-lock-'));
    const filePath = path.join(tempDir, 'sample.js');
    const logFile = path.join(tempDir, 'npx.log');
    const stateFile = path.join(tempDir, 'debounce.json');
    const lockFile = `${stateFile}.lock`;
    const binDir = createFakeNpx(logFile);

    fs.writeFileSync(filePath, 'const y = 2;\n');
    fs.writeFileSync(lockFile, 'locked');

    const staleTime = new Date(Date.now() - 60_000);
    fs.utimesSync(lockFile, staleTime, staleTime);

    const env = {
      PATH: `${binDir}:${process.env.PATH || ''}`,
      HOOK_ROUTER_DEBOUNCE_FILE: stateFile,
      HOOK_DEBOUNCE_FORMAT_MS: '0',
      HOOK_DEBOUNCE_LOCK_STALE_MS: '1',
    };

    try {
      expect(runWorker(['--task', 'format', '--file', filePath, '--cwd', tempDir], env).status).toBe(0);

      const invocations = fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean);
      expect(invocations).toHaveLength(1);
      expect(fs.existsSync(lockFile)).toBe(false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
      fs.rmSync(binDir, { recursive: true, force: true });
    }
  });
});
