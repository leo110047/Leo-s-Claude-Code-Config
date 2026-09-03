import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  acceptControllerStartupLockHandoff,
  acquireControllerStartupLock,
  claimControllerState,
  controllerOwner,
  probeControllerHealth,
  readControllerState,
  readControllerStateResult,
  removeOwnedControllerState,
  replaceControllerState,
  updateOwnedControllerState,
  type ControllerState,
} from '../src/controller-state';

const tempDirs: string[] = [];

function tempStateFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browse-owner-state-'));
  tempDirs.push(dir);
  return path.join(dir, 'browse.json');
}

function state(instanceId: string, overrides: Partial<ControllerState> = {}): ControllerState {
  return {
    pid: process.pid,
    port: 30_000,
    token: `token-${instanceId}-0123456789`,
    startedAt: '2026-09-02T00:00:00.000Z',
    serverPath: '/test/server.ts',
    instanceId,
    processStartTime: 'start-a',
    phase: 'ready',
    mode: 'headed',
    ...overrides,
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('controller state compare-and-swap', () => {
  test('one read distinguishes missing, valid, malformed, and unreadable state', () => {
    const stateFile = tempStateFile();
    expect(readControllerStateResult(stateFile)).toEqual({ status: 'missing' });

    const owner = state('owner-a');
    fs.writeFileSync(stateFile, JSON.stringify(owner));
    expect(readControllerStateResult(stateFile)).toEqual({ status: 'valid', state: owner });

    fs.writeFileSync(stateFile, '{not-json');
    expect(readControllerStateResult(stateFile)).toEqual({ status: 'malformed' });
    expect(readControllerStateResult(path.dirname(stateFile))).toEqual({ status: 'unreadable' });
  });

  test('startup lock handoff requires the exact live lock and transfers release ownership', () => {
    const stateFile = tempStateFile();
    const parentLock = acquireControllerStartupLock(stateFile);
    expect(parentLock).not.toBeNull();

    const adoptedLock = acceptControllerStartupLockHandoff(stateFile, parentLock!.handoff);
    expect(adoptedLock).not.toBeNull();
    expect(acceptControllerStartupLockHandoff(stateFile, parentLock!.handoff)).toBeNull();

    parentLock!.release();
    expect(fs.existsSync(`${stateFile}.lock`)).toBe(true);
    adoptedLock!.release();
    expect(fs.existsSync(`${stateFile}.lock`)).toBe(false);
  });

  test('startup lock handoff rejects environment data that does not match the lockfile', () => {
    const stateFile = tempStateFile();
    const startupLock = acquireControllerStartupLock(stateFile);
    expect(startupLock).not.toBeNull();
    const forged = JSON.stringify({ pid: process.pid, nonce: 'forged' });

    expect(acceptControllerStartupLockHandoff(stateFile, forged)).toBeNull();
    expect(fs.existsSync(`${stateFile}.lock`)).toBe(true);
    startupLock!.release();
  });

  test('only the first owner can claim an empty canonical state file', () => {
    const stateFile = tempStateFile();
    const ownerA = state('owner-a');
    const ownerB = state('owner-b', { port: 30_001 });

    expect(replaceControllerState(stateFile, null, ownerA)).toBe(true);
    expect(replaceControllerState(stateFile, null, ownerB)).toBe(false);
    expect(readControllerState(stateFile)).toEqual(ownerA);
  });

  test('malformed canonical state is preserved instead of treated as missing', async () => {
    const stateFile = tempStateFile();
    fs.writeFileSync(stateFile, '{not-json');
    const before = fs.readFileSync(stateFile, 'utf-8');

    const result = await claimControllerState(stateFile, state('owner-b'));

    expect(result).toEqual({ outcome: 'refused', reason: 'malformed' });
    expect(fs.readFileSync(stateFile, 'utf-8')).toBe(before);
  });

  test('stale owner cannot update or delete a newer owner pointer', () => {
    const stateFile = tempStateFile();
    const ownerA = state('owner-a');
    const ownerB = state('owner-b', { port: 30_001 });
    expect(replaceControllerState(stateFile, null, ownerA)).toBe(true);
    expect(replaceControllerState(stateFile, controllerOwner(ownerA), ownerB)).toBe(true);

    expect(updateOwnedControllerState(
      stateFile,
      controllerOwner(ownerA),
      (current) => ({ ...current, tunnelLocalPort: 44_444 }),
    )).toBe(false);
    expect(removeOwnedControllerState(stateFile, controllerOwner(ownerA))).toBe(false);
    expect(readControllerState(stateFile)).toEqual(ownerB);
  });

  test('health-unreachable plus EPERM-style unknown liveness preserves the owner', async () => {
    const stateFile = tempStateFile();
    const ownerA = state('owner-a');
    const ownerB = state('owner-b', { pid: process.pid + 1, port: 30_001 });
    expect(replaceControllerState(stateFile, null, ownerA)).toBe(true);
    const before = fs.readFileSync(stateFile, 'utf-8');

    const sandboxAttempt = await claimControllerState(stateFile, ownerB, {
      healthProbe: async () => 'unreachable',
      livenessProbe: () => 'unknown',
      startTimeReader: () => '',
    });

    expect(sandboxAttempt.outcome).toBe('refused');
    expect(sandboxAttempt).toMatchObject({
      reason: 'owner-present',
      inspection: { status: 'unknown', liveness: 'unknown' },
    });
    expect(fs.readFileSync(stateFile, 'utf-8')).toBe(before);

    const hostRetry = await claimControllerState(stateFile, ownerB, {
      healthProbe: async () => 'healthy',
      livenessProbe: () => 'alive',
      startTimeReader: () => ownerA.processStartTime || '',
    });
    expect(hostRetry.outcome).toBe('refused');
    expect(hostRetry).toMatchObject({
      reason: 'owner-present',
      inspection: { status: 'healthy' },
    });
    expect(readControllerState(stateFile)).toEqual(ownerA);
  });

  test('confirmed dead owner can be replaced without pre-unlinking the pointer', async () => {
    const stateFile = tempStateFile();
    const ownerA = state('owner-a');
    const ownerB = state('owner-b', { pid: process.pid + 1, port: 30_001 });
    expect(replaceControllerState(stateFile, null, ownerA)).toBe(true);

    const result = await claimControllerState(stateFile, ownerB, {
      healthProbe: async () => 'unreachable',
      livenessProbe: () => 'dead',
    });

    expect(result).toEqual({ outcome: 'claimed' });
    expect(readControllerState(stateFile)).toEqual(ownerB);
  });

  test('PID reuse is stale state and never authorizes deleting the unrelated process state', async () => {
    const stateFile = tempStateFile();
    const ownerA = state('owner-a', { processStartTime: 'old-process-start' });
    const ownerB = state('owner-b', { pid: process.pid + 1, port: 30_001 });
    expect(replaceControllerState(stateFile, null, ownerA)).toBe(true);

    const result = await claimControllerState(stateFile, ownerB, {
      healthProbe: async () => 'unreachable',
      livenessProbe: () => 'alive',
      startTimeReader: () => 'reused-process-start',
    });

    expect(result).toEqual({ outcome: 'claimed' });
    expect(readControllerState(stateFile)).toEqual(ownerB);
  });

  test('health from a different instance is not accepted as the recorded owner', async () => {
    const ownerA = state('owner-a');
    const fakeFetch = (async () => Response.json({
      status: 'healthy',
      instanceId: 'owner-b',
    })) as typeof fetch;

    expect(await probeControllerHealth(ownerA, fakeFetch)).toBe('foreign');
  });

  test('health without an exact instance identity is foreign', async () => {
    const owner = state('legacy-owner', { instanceId: undefined });
    const fakeFetch = (async () => Response.json({ status: 'healthy' })) as typeof fetch;

    expect(await probeControllerHealth(owner, fakeFetch)).toBe('foreign');
  });

  test('a matching instance is not reusable until its ready phase is published', async () => {
    const owner = state('starting-owner', { phase: 'starting' });
    const fakeFetch = (async () => Response.json({
      status: 'healthy',
      instanceId: owner.instanceId,
    })) as typeof fetch;

    expect(await probeControllerHealth(owner, fakeFetch)).toBe('unhealthy');
  });
});
