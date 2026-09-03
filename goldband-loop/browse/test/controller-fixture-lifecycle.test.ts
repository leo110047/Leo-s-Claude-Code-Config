import { afterEach, describe, expect, test } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ControllerState } from '../src/controller-state';
import {
  cleanupControllerFixture,
  waitForControllerAbsence,
} from './controller-fixture-lifecycle';
import { canStartTestServer } from './test-server';

const CONTROLLER_TEST = path.resolve(import.meta.dir, 'controller-ownership.integration.test.ts');
const FIXTURE_SERVER = path.resolve(import.meta.dir, 'fixtures/controller-server.ts');
const tempDirs: string[] = [];
const children = new Set<ChildProcess>();
const describeWithLocalhost = process.platform !== 'win32' && canStartTestServer()
  ? describe
  : describe.skip;

afterEach(async () => {
  const errors: unknown[] = [];
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null && child.pid) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    }
  }
  children.clear();
  for (const dir of tempDirs.splice(0)) {
    try {
      await cleanupControllerFixture(
        path.join(dir, 'controller-state', 'browse.json'),
        new Set([FIXTURE_SERVER]),
      );
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) throw new AggregateError(errors, 'lifecycle regression cleanup failed');
});

describeWithLocalhost('controller fixture lifecycle', () => {
  test('an assertion failure after owner publish still removes the PID and listen port', async () => {
    const run = await startLifecycleChild('assertion-failure');
    const exitCode = await childExit(run.child);
    const owner = await readOwner(run.ownerFile);

    expect(exitCode).not.toBe(0);
    expect(await waitForControllerAbsence(owner)).toBe(true);
    expect(fs.existsSync(run.stateFile)).toBe(false);
  }, 15_000);

  test('runner interruption leaves the detached fixture to its owner watchdog', async () => {
    const run = await startLifecycleChild('runner-interruption');
    const owner = await readOwner(run.ownerFile);
    if (!run.child.pid) throw new Error('fixture lifecycle child has no PID');

    process.kill(-run.child.pid, 'SIGKILL');
    await childExit(run.child);

    expect(await waitForControllerAbsence(owner)).toBe(true);
    expect(await waitFor(() => !fs.existsSync(run.stateFile))).toBe(true);
  }, 15_000);

  test('a timed-out test still removes the published PID and listen port', async () => {
    const run = await startLifecycleChild('test-timeout');
    const exitCode = await childExit(run.child);
    const owner = await readOwner(run.ownerFile);

    expect(exitCode).not.toBe(0);
    expect(await waitForControllerAbsence(owner)).toBe(true);
    expect(fs.existsSync(run.stateFile)).toBe(false);
  }, 15_000);

  test('identity-bound cleanup force-kills a fixture that ignores SIGTERM', async () => {
    const run = await startLifecycleChild('ignore-sigterm');
    const exitCode = await childExit(run.child);
    const owner = await readOwner(run.ownerFile);

    expect(exitCode).toBe(0);
    expect(await waitForControllerAbsence(owner)).toBe(true);
    expect(fs.existsSync(run.stateFile)).toBe(false);
  }, 15_000);
});

async function startLifecycleChild(scenario: string): Promise<{
  child: ChildProcess;
  ownerFile: string;
  stateFile: string;
}> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'controller-lifecycle-regression-'));
  tempDirs.push(dir);
  const ownerFile = path.join(dir, 'owner.json');
  const stateFile = path.join(dir, 'controller-state', 'browse.json');
  const child = spawn(process.execPath, [
    'test',
    CONTROLLER_TEST,
    '--max-concurrency=1',
    '--timeout=60000',
    '--test-name-pattern',
    `fixture lifecycle child: ${scenario}`,
  ], {
    cwd: path.resolve(import.meta.dir, '../..'),
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: {
      ...process.env,
      BROWSE_FIXTURE_LIFECYCLE_SCENARIO: scenario,
      BROWSE_FIXTURE_LIFECYCLE_ARTIFACT_DIR: dir,
    },
  });
  children.add(child);
  await readOwner(ownerFile);
  return { child, ownerFile, stateFile };
}

function childExit(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) {
      children.delete(child);
      resolve(child.exitCode);
      return;
    }
    child.once('error', reject);
    child.once('close', (code, signal) => {
      children.delete(child);
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

async function readOwner(file: string): Promise<ControllerState> {
  const available = await waitFor(() => fs.existsSync(file));
  if (!available) throw new Error(`fixture owner was not published: ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as ControllerState;
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  do {
    if (predicate()) return true;
    if (Date.now() >= deadline) return false;
    await Bun.sleep(Math.min(20, deadline - Date.now()));
  } while (true);
}
