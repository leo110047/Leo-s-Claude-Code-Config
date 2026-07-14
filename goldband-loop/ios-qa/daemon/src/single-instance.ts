// Single-instance enforcement. Daemon takes an exclusive flock on
// ~/.goldband/ios-qa-daemon.pid on startup. Second invocation discovers the
// existing daemon's port + connects. Stale lock (PID dead) is reclaimed.
//
// Readiness protocol: daemon writes `READY: port=<n> pid=<pid>` to stdout
// once both listeners are up; the spawner reads stdout with a 5s timeout.

import { readFile, mkdir, unlink } from 'fs/promises';
import { existsSync, openSync, writeSync, closeSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

export interface PidfileContents {
  pid: number;
  port: number;
  startedAt: number;
}

function defaultPidfilePath(): string {
  return process.env.GOLDBAND_IOS_DAEMON_PIDFILE
    ?? join(homedir(), '.goldband', 'ios-qa-daemon.pid');
}

/**
 * Try to claim the pidfile. Returns:
 * - { claimed: true } when this process now owns the lock
 * - { claimed: false, existing } when another live daemon holds it
 *
 * The "live" check is process.kill(pid, 0): succeeds if the PID exists,
 * fails with ESRCH if not. We DO NOT trust a stale pidfile.
 */
export async function tryClaim(opts: {
  port: number;
  path?: string;
}): Promise<
  | { claimed: true; release: () => Promise<void> }
  | { claimed: false; existing: PidfileContents }
> {
  const path = opts.path ?? defaultPidfilePath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });

  // Check for an existing pidfile.
  if (existsSync(path)) {
    try {
      const raw = await readFile(path, 'utf-8');
      const existing = JSON.parse(raw) as PidfileContents;
      if (isAlive(existing.pid)) {
        return { claimed: false, existing };
      }
      // Stale — drop it and continue to claim.
      await unlink(path).catch(() => {});
    } catch {
      // Unparseable pidfile — treat as stale.
      await unlink(path).catch(() => {});
    }
  }

  // Use SYNCHRONOUS open with O_EXCL for atomic exclusion. Bun's async
  // fs.open(wx) doesn't reliably preserve O_EXCL semantics across concurrent
  // calls in the same process. Sync openSync goes straight to syscall and is
  // genuinely atomic.
  //
  // Constant 0x800 = O_EXCL on macOS/Linux; combined with O_CREAT (0x200) and
  // O_WRONLY (0x1) it's the equivalent of 'wx'. The sync API accepts the
  // string flag form too, but explicit numeric flags are the most defensive.
  const contents: PidfileContents = {
    pid: process.pid,
    port: opts.port,
    startedAt: Date.now(),
  };
  let fd: number;
  try {
    fd = openSync(path, 'wx', 0o600);
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === 'EEXIST') {
      // Race: another caller won.
      const raw = await readFile(path, 'utf-8').catch(() => '{}');
      const existing = JSON.parse(raw || '{}') as PidfileContents;
      return { claimed: false, existing };
    }
    throw err;
  }
  try {
    writeSync(fd, JSON.stringify(contents, null, 2));
  } finally {
    closeSync(fd);
  }

  // Cleanup on exit.
  const cleanup = async () => {
    try {
      // Verify we still own it before unlinking.
      const raw = await readFile(path, 'utf-8');
      const cur = JSON.parse(raw) as PidfileContents;
      if (cur.pid === process.pid) {
        await unlink(path);
      }
    } catch {
      // best-effort
    }
  };

  process.on('exit', () => {
    try { unlinkSync(path); } catch { /* ignore */ }
  });
  process.on('SIGINT', () => { cleanup().finally(() => process.exit(0)); });
  process.on('SIGTERM', () => { cleanup().finally(() => process.exit(0)); });

  return { claimed: true, release: cleanup };
}

function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    const e = err as { code?: string };
    return e.code !== 'ESRCH';
  }
}
