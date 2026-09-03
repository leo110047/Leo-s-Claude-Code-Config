/**
 * Authoritative controller ownership for one canonical browse.json path.
 *
 * The state file is a capability pointer, not a cache: replacing or deleting it
 * changes which browser an agent controls. All transitions therefore use an
 * owner identity plus compare-and-swap under a project-scoped lock.
 */
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  probeProcessLiveness,
  readProcessStartTime,
  type ProcessLiveness,
} from './error-handling';

export interface ControllerState {
  pid: number;
  port: number;
  token: string;
  startedAt: string;
  serverPath: string;
  instanceId?: string;
  processStartTime?: string;
  phase?: 'starting' | 'ready';
  binaryVersion?: string;
  mode?: 'launched' | 'headed';
  configHash?: string;
  xvfbPid?: number;
  xvfbStartTime?: string;
  xvfbDisplay?: string;
  tunnel?: unknown;
  tunnelLocalPort?: number;
}

export type ControllerStateReadResult =
  | { status: 'missing' }
  | { status: 'valid'; state: ControllerState }
  | { status: 'malformed' }
  | { status: 'unreadable' };

export interface ControllerOwner {
  pid: number;
  token: string;
  startedAt: string;
  instanceId?: string;
}

export type ControllerHealth = 'healthy' | 'unhealthy' | 'unreachable' | 'foreign';
type ControllerStatus = ControllerHealth | 'dead' | 'stale' | 'unknown';

export interface ControllerInspection {
  status: ControllerStatus;
  health: ControllerHealth;
  liveness: ProcessLiveness;
  identity: 'match' | 'mismatch' | 'unknown';
}

export interface ControllerInspectionOptions {
  healthProbe?: (state: ControllerState) => Promise<ControllerHealth>;
  livenessProbe?: (pid: number) => ProcessLiveness;
  startTimeReader?: (pid: number) => string;
}

function isControllerState(value: unknown): value is ControllerState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Record<string, unknown>;
  return Number.isInteger(state.pid)
    && Number.isInteger(state.port)
    && typeof state.token === 'string'
    && typeof state.startedAt === 'string'
    && typeof state.serverPath === 'string';
}

export function readControllerStateResult(stateFile: string): ControllerStateReadResult {
  let raw: string;
  try {
    raw = fs.readFileSync(stateFile, 'utf-8');
  } catch (error: any) {
    return error?.code === 'ENOENT' ? { status: 'missing' } : { status: 'unreadable' };
  }
  try {
    const parsed = JSON.parse(raw);
    return isControllerState(parsed)
      ? { status: 'valid', state: parsed }
      : { status: 'malformed' };
  } catch {
    return { status: 'malformed' };
  }
}

export function readControllerState(stateFile: string): ControllerState | null {
  const result = readControllerStateResult(stateFile);
  return result.status === 'valid' ? result.state : null;
}

export function controllerOwner(state: ControllerState): ControllerOwner {
  return {
    pid: state.pid,
    token: state.token,
    startedAt: state.startedAt,
    ...(state.instanceId ? { instanceId: state.instanceId } : {}),
  };
}

export function sameControllerOwner(
  state: ControllerState | null,
  expected: ControllerOwner,
): boolean {
  if (!state) return false;
  if (state.instanceId || expected.instanceId) {
    return Boolean(state.instanceId)
      && state.instanceId === expected.instanceId
      && state.pid === expected.pid
      && state.token === expected.token
      && state.startedAt === expected.startedAt;
  }
  return state.pid === expected.pid
    && state.token === expected.token
    && state.startedAt === expected.startedAt;
}

export async function probeControllerHealth(
  state: ControllerState,
  fetchImpl: typeof fetch = fetch,
): Promise<ControllerHealth> {
  try {
    const response = await fetchImpl(`http://127.0.0.1:${state.port}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return 'unhealthy';
    const health = await response.json() as Record<string, unknown>;
    if (!state.instanceId || health.instanceId !== state.instanceId) return 'foreign';
    if (health.status !== 'healthy') return 'unhealthy';
    if (state.phase !== 'ready') return 'unhealthy';
    return 'healthy';
  } catch {
    return 'unreachable';
  }
}

export async function inspectControllerState(
  state: ControllerState,
  options: ControllerInspectionOptions = {},
): Promise<ControllerInspection> {
  const health = await (options.healthProbe ?? probeControllerHealth)(state);
  if (health === 'healthy') {
    return { status: 'healthy', health, liveness: 'alive', identity: 'match' };
  }

  const liveness = (options.livenessProbe ?? probeProcessLiveness)(state.pid);
  if (liveness === 'dead') {
    return {
      status: health === 'foreign' ? 'stale' : 'dead',
      health,
      liveness,
      identity: 'unknown',
    };
  }
  if (liveness === 'unknown') {
    return { status: 'unknown', health, liveness, identity: 'unknown' };
  }

  if (!state.processStartTime) {
    return { status: health, health, liveness, identity: 'unknown' };
  }
  const currentStartTime = (options.startTimeReader ?? readProcessStartTime)(state.pid);
  if (!currentStartTime) {
    return { status: 'unknown', health, liveness, identity: 'unknown' };
  }
  if (currentStartTime !== state.processStartTime) {
    return { status: 'stale', health, liveness, identity: 'mismatch' };
  }
  return { status: health, health, liveness, identity: 'match' };
}

export type ControllerTransition = 'reuse' | 'replace' | 'refuse';

export function decideControllerTransition(inspection: ControllerInspection): ControllerTransition {
  if (inspection.status === 'healthy') return 'reuse';
  if (inspection.status === 'dead' || inspection.status === 'stale') return 'replace';
  return 'refuse';
}

export type ControllerClaimResult =
  | { outcome: 'claimed' }
  | { outcome: 'refused'; reason: 'malformed' | 'unreadable' | 'owner-present' | 'race'; inspection?: ControllerInspection };

export async function claimControllerState(
  stateFile: string,
  next: ControllerState,
  options: ControllerInspectionOptions = {},
): Promise<ControllerClaimResult> {
  const readResult = readControllerStateResult(stateFile);
  if (readResult.status === 'malformed') {
    return { outcome: 'refused', reason: 'malformed' };
  }
  if (readResult.status === 'unreadable') {
    return { outcome: 'refused', reason: 'unreadable' };
  }
  const current = readResult.status === 'valid' ? readResult.state : null;
  if (current) {
    const inspection = await inspectControllerState(current, options);
    if (decideControllerTransition(inspection) !== 'replace') {
      return { outcome: 'refused', reason: 'owner-present', inspection };
    }
  }
  const expected = current ? controllerOwner(current) : null;
  return replaceControllerState(stateFile, expected, next)
    ? { outcome: 'claimed' }
    : { outcome: 'refused', reason: 'race' };
}

interface LockRecord {
  pid: number;
  nonce: string;
  processStartTime?: string;
}

export interface ControllerStartupLock {
  readonly handoff: string;
  release(): void;
}

function parseLockRecord(raw: string): LockRecord | null {
  try {
    const parsed = JSON.parse(raw) as Partial<LockRecord>;
    if (!Number.isInteger(parsed.pid) || typeof parsed.nonce !== 'string') return null;
    return parsed as LockRecord;
  } catch {
    const legacyPid = Number.parseInt(raw.trim(), 10);
    return Number.isInteger(legacyPid) && legacyPid > 0
      ? { pid: legacyPid, nonce: 'legacy' }
      : null;
  }
}

function releaseOwnedLock(lockPath: string, nonce: string): void {
  try {
    const current = parseLockRecord(fs.readFileSync(lockPath, 'utf-8'));
    if (current?.nonce === nonce && current.pid === process.pid) fs.unlinkSync(lockPath);
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function createLock(lockPath: string, record: LockRecord): (() => void) {
  const fd = fs.openSync(lockPath, 'wx', 0o600);
  let writeError: unknown;
  try {
    fs.writeFileSync(fd, JSON.stringify(record));
  } catch (error) {
    writeError = error;
  } finally {
    fs.closeSync(fd);
  }
  if (writeError) {
    try { fs.unlinkSync(lockPath); } catch {}
    throw writeError;
  }
  return () => releaseOwnedLock(lockPath, record.nonce);
}

function readLockHolder(lockPath: string): LockRecord | null {
  try {
    return parseLockRecord(fs.readFileSync(lockPath, 'utf-8'));
  } catch {
    return null;
  }
}

function sameLockRecord(left: LockRecord | null, right: LockRecord): boolean {
  return Boolean(left)
    && left!.pid === right.pid
    && left!.nonce === right.nonce
    && left!.processStartTime === right.processStartTime;
}

function lockHolderIsExactLive(holder: LockRecord): boolean {
  if (probeProcessLiveness(holder.pid) !== 'alive') return false;
  if (!holder.processStartTime) return true;
  return readProcessStartTime(holder.pid) === holder.processStartTime;
}

function atomicReplaceLockRecord(lockPath: string, record: LockRecord): void {
  const tmpPath = `${lockPath}.handoff-${process.pid}-${record.nonce}`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmpPath, lockPath);
  } catch (error) {
    try { fs.unlinkSync(tmpPath); } catch {}
    throw error;
  }
}

function lockHolderIsReplaceable(holder: LockRecord): boolean {
  const liveness = probeProcessLiveness(holder.pid);
  if (liveness === 'dead') return true;
  if (liveness !== 'alive' || !holder.processStartTime) return false;
  const currentStartTime = readProcessStartTime(holder.pid);
  return Boolean(currentStartTime && currentStartTime !== holder.processStartTime);
}

function acquireReclaimGuard(lockPath: string, record: LockRecord): (() => void) | null {
  try {
    return createLock(`${lockPath}.reclaim`, record);
  } catch (error: any) {
    if (error?.code === 'EEXIST') return null;
    throw error;
  }
}

function reclaimLock(lockPath: string, record: LockRecord): (() => void) | null {
  const releaseReclaim = acquireReclaimGuard(lockPath, record);
  if (!releaseReclaim) return null;
  try {
    // Re-read only after winning the non-reclaimable guard. Every contender
    // observes this guard before creating the primary lock, so nobody can
    // replace the path between this decision and our create.
    const holder = readLockHolder(lockPath);
    if (!holder || !lockHolderIsReplaceable(holder)) return null;
    try {
      fs.unlinkSync(lockPath);
    } catch (error: any) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
    try {
      return createLock(lockPath, record);
    } catch (error: any) {
      if (error?.code === 'EEXIST') return null;
      throw error;
    }
  } finally {
    releaseReclaim();
  }
}

function acquireLock(lockPath: string): (() => void) | null {
  const nonce = randomUUID();
  const ownerStartTime = readProcessStartTime(process.pid);
  const record: LockRecord = {
    pid: process.pid,
    nonce,
    ...(ownerStartTime ? { processStartTime: ownerStartTime } : {}),
  };

  // A reclaim guard is deliberately never auto-stolen. If its holder dies in
  // the tiny reclaim critical section, future callers fail closed instead of
  // risking two lock owners. Manual removal is safer than split brain.
  if (fs.existsSync(`${lockPath}.reclaim`)) return null;
  try {
    return createLock(lockPath, record);
  } catch (error: any) {
    if (error?.code !== 'EEXIST') throw error;
    return reclaimLock(lockPath, record);
  }
}

export function acquireControllerStartupLock(stateFile: string): ControllerStartupLock | null {
  const lockPath = `${stateFile}.lock`;
  const nonce = randomUUID();
  const ownerStartTime = readProcessStartTime(process.pid);
  const record: LockRecord = {
    pid: process.pid,
    nonce,
    ...(ownerStartTime ? { processStartTime: ownerStartTime } : {}),
  };
  let release: (() => void) | null = null;
  if (!fs.existsSync(`${lockPath}.reclaim`)) {
    try {
      release = createLock(lockPath, record);
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      release = reclaimLock(lockPath, record);
    }
  }
  return release ? { handoff: JSON.stringify(record), release } : null;
}

/**
 * Atomically transfer an exact CLI startup-lock lease to its spawned server.
 * The lockfile remains authoritative: environment data alone grants nothing.
 */
export function acceptControllerStartupLockHandoff(
  stateFile: string,
  handoff: string | undefined,
): ControllerStartupLock | null {
  if (!handoff) return null;
  let expected: LockRecord | null;
  try {
    expected = parseLockRecord(handoff);
  } catch {
    return null;
  }
  if (!expected || expected.nonce === 'legacy') return null;

  const lockPath = `${stateFile}.lock`;
  const processStartTime = readProcessStartTime(process.pid);
  const adopted: LockRecord = {
    pid: process.pid,
    nonce: randomUUID(),
    ...(processStartTime ? { processStartTime } : {}),
  };
  const releaseGuard = acquireReclaimGuard(lockPath, adopted);
  if (!releaseGuard) return null;
  try {
    const current = readLockHolder(lockPath);
    if (!sameLockRecord(current, expected) || !lockHolderIsExactLive(current!)) return null;
    atomicReplaceLockRecord(lockPath, adopted);
  } finally {
    releaseGuard();
  }
  return {
    handoff: JSON.stringify(adopted),
    release: () => releaseOwnedLock(lockPath, adopted.nonce),
  };
}

function atomicWriteState(stateFile: string, state: ControllerState): void {
  const tmpFile = `${stateFile}.tmp-${process.pid}-${randomUUID()}`;
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true, mode: 0o700 });
    fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(tmpFile, stateFile);
  } catch (error) {
    try { fs.unlinkSync(tmpFile); } catch {}
    throw error;
  }
}

export function replaceControllerState(
  stateFile: string,
  expected: ControllerOwner | null,
  next: ControllerState,
): boolean {
  const release = acquireLock(`${stateFile}.owner-lock`);
  if (!release) return false;
  try {
    const current = readControllerState(stateFile);
    const matches = expected
      ? sameControllerOwner(current, expected)
      : current === null && !fs.existsSync(stateFile);
    if (!matches) return false;
    atomicWriteState(stateFile, next);
    return true;
  } finally {
    release();
  }
}

export function updateOwnedControllerState(
  stateFile: string,
  owner: ControllerOwner,
  update: (state: ControllerState) => ControllerState,
): boolean {
  const release = acquireLock(`${stateFile}.owner-lock`);
  if (!release) return false;
  try {
    const current = readControllerState(stateFile);
    if (!sameControllerOwner(current, owner)) return false;
    atomicWriteState(stateFile, update(current as ControllerState));
    return true;
  } finally {
    release();
  }
}

export function removeOwnedControllerState(
  stateFile: string,
  owner: ControllerOwner,
): boolean {
  const release = acquireLock(`${stateFile}.owner-lock`);
  if (!release) return false;
  try {
    const current = readControllerState(stateFile);
    if (!sameControllerOwner(current, owner)) return false;
    try {
      fs.unlinkSync(stateFile);
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }
    return true;
  } finally {
    release();
  }
}
