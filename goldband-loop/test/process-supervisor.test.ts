import { afterEach, describe, expect, test } from 'bun:test';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { superviseCommand } from '../scripts/process-supervisor.mjs';

const SUPERVISOR_MODULE = pathToFileURL(
  resolve(import.meta.dir, '../scripts/process-supervisor.mjs'),
).href;
const tempDirs: string[] = [];
const spawnedPids = new Set<number>();

afterEach(() => {
  for (const pid of spawnedPids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
  spawnedPids.clear();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('process supervisor', () => {
  test('returns the child exit code after a normal completion', async () => {
    const result = await superviseCommand(
      process.execPath,
      ['-e', 'process.exit(7)'],
      { timeoutMs: 2_000 },
    );

    expect(result).toEqual({ exitCode: 7, reason: 'exit', signal: null });
  });

  test('kills the complete process group after the wall-clock timeout', async () => {
    if (process.platform === 'win32') return;
    const dir = makeTempDir();
    const grandchildPidFile = join(dir, 'grandchild.pid');
    const target = childTreeSource(grandchildPidFile);

    const result = await superviseCommand(
      process.execPath,
      ['-e', target],
      { timeoutMs: 300, killGraceMs: 100 },
    );

    const grandchildPid = await readPid(grandchildPidFile);
    expect(result.exitCode).toBe(124);
    expect(result.reason).toBe('timeout');
    expect(await waitForExit(grandchildPid)).toBe(true);
  });

  test('kills descendants that ignore the graceful termination signal', async () => {
    if (process.platform === 'win32') return;
    const dir = makeTempDir();
    const grandchildPidFile = join(dir, 'grandchild.pid');
    const target = childTreeSource(grandchildPidFile, {
      ignoreSigterm: true,
      exitParentOnSigterm: true,
    });

    const result = await superviseCommand(process.execPath, ['-e', target], {
      timeoutMs: 300,
      killGraceMs: 100,
    });

    const grandchildPid = await readPid(grandchildPidFile);
    expect(result.exitCode).toBe(124);
    expect(isAlive(grandchildPid)).toBe(false);
  });

  test('cleans descendants left behind after the root exits normally', async () => {
    if (process.platform === 'win32') return;
    const dir = makeTempDir();
    const grandchildPidFile = join(dir, 'grandchild.pid');
    const grandchildSource = [
      `process.on('SIGTERM', () => {});`,
      `setInterval(() => {}, 1000);`,
    ].join(' ');
    const target = [
      `const { spawn } = require('node:child_process');`,
      `const { writeFileSync } = require('node:fs');`,
      `const child = spawn(process.execPath, ['-e', ${JSON.stringify(grandchildSource)}], { stdio: 'ignore' });`,
      `writeFileSync(${JSON.stringify(grandchildPidFile)}, String(child.pid));`,
      `setTimeout(() => process.exit(0), 50);`,
    ].join('\n');

    const result = await superviseCommand(process.execPath, ['-e', target], {
      timeoutMs: 2_000,
      killGraceMs: 100,
    });
    const grandchildPid = await readPid(grandchildPidFile);
    spawnedPids.add(grandchildPid);
    expect(result.exitCode).toBe(0);
    expect(result.reason).toBe('exit');
    expect(await waitForExit(grandchildPid)).toBe(true);
    spawnedPids.delete(grandchildPid);
  });

  test('kills a test process that reports completion but does not exit', async () => {
    if (process.platform === 'win32') return;
    const dir = makeTempDir();
    const grandchildPidFile = join(dir, 'grandchild.pid');
    const target = [
      childTreeSource(grandchildPidFile),
      `process.stdout.write('Ran 1 test across 1 file.\\n');`,
    ].join('\n');

    const result = await superviseCommand(
      process.execPath,
      ['-e', target],
      {
        timeoutMs: 10_000,
        killGraceMs: 100,
        completionPattern: /Ran \d+ tests? across \d+ files?\./,
        completionExitGraceMs: 100,
      },
    );

    const grandchildPid = await readPid(grandchildPidFile);
    expect(result.exitCode).toBe(126);
    expect(result.reason).toBe('completion-stall');
    expect(await waitForExit(grandchildPid)).toBe(true);
  });

  test('forwards SIGTERM and kills the complete process group', async () => {
    if (process.platform === 'win32') return;
    const dir = makeTempDir();
    const grandchildPidFile = join(dir, 'grandchild.pid');
    const supervisorSource = [
      `import { superviseCommand } from ${JSON.stringify(SUPERVISOR_MODULE)};`,
      `const target = ${JSON.stringify(childTreeSource(grandchildPidFile))};`,
      `const result = await superviseCommand(process.execPath, ['-e', target], { timeoutMs: 10_000, killGraceMs: 100 });`,
      `process.exit(result.exitCode);`,
    ].join('\n');
    const supervisor = Bun.spawn(
      [process.execPath, '--input-type=module', '-e', supervisorSource],
      {
        stdout: 'ignore',
        stderr: 'inherit',
      },
    );
    spawnedPids.add(supervisor.pid);

    const grandchildPid = await readPid(grandchildPidFile);
    spawnedPids.add(grandchildPid);
    supervisor.kill('SIGTERM');
    expect(await supervisor.exited).toBe(143);
    spawnedPids.delete(supervisor.pid);

    expect(await waitForExit(grandchildPid)).toBe(true);
    spawnedPids.delete(grandchildPid);
  });

});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'goldband-process-supervisor-'));
  tempDirs.push(dir);
  return dir;
}

function childTreeSource(
  grandchildPidFile: string,
  options: { ignoreSigterm?: boolean; exitParentOnSigterm?: boolean } = {},
): string {
  const grandchildSource = [
    options.ignoreSigterm ? `process.on('SIGTERM', () => {});` : '',
    `setInterval(() => {}, 1000);`,
  ]
    .filter(Boolean)
    .join(' ');
  return [
    `const { spawn } = require('node:child_process');`,
    `const { writeFileSync } = require('node:fs');`,
    `const child = spawn(process.execPath, ['-e', ${JSON.stringify(grandchildSource)}], { stdio: 'ignore' });`,
    `writeFileSync(${JSON.stringify(grandchildPidFile)}, String(child.pid));`,
    options.exitParentOnSigterm
      ? `process.on('SIGTERM', () => process.exit(0));`
      : '',
    `setInterval(() => {}, 1_000);`,
  ]
    .filter(Boolean)
    .join('\n');
}

async function readPid(file: string): Promise<number> {
  const available = await waitFor(() => {
    try {
      return Number.parseInt(readFileSync(file, 'utf8'), 10) > 0;
    } catch {
      return false;
    }
  });
  if (!available) throw new Error(`PID file was not written: ${file}`);
  return Number.parseInt(readFileSync(file, 'utf8'), 10);
}

async function waitForExit(pid: number): Promise<boolean> {
  return waitFor(() => !isAlive(pid), 3_000);
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await Bun.sleep(10);
  }
  return predicate();
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
