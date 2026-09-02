/**
 * Shared error-handling utilities for browse server and CLI.
 *
 * Each wrapper uses selective catches (checks err.code) to avoid masking
 * unexpected errors. Empty catches would be flagged by slop-scan.
 */

import * as fs from 'fs';

export type ProcessLiveness = 'alive' | 'dead' | 'unknown';

interface ProcessProbeOptions {
  platform?: NodeJS.Platform;
  kill?: (pid: number, signal: number) => void;
  spawnSync?: typeof Bun.spawnSync;
}

function probeWindowsProcess(
  pid: number,
  spawnSync: typeof Bun.spawnSync,
): ProcessLiveness {
  try {
    const result = spawnSync(
      ['tasklist', '/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'],
      { stdout: 'pipe', stderr: 'pipe', timeout: 3000 },
    );
    if (result.exitCode !== 0) return 'unknown';
    return result.stdout.toString().includes(`"${pid}"`) ? 'alive' : 'dead';
  } catch {
    return 'unknown';
  }
}

// ─── Filesystem ────────────────────────────────────────────────

/** Remove a file, ignoring ENOENT (already gone). Rethrows other errors. */
export function safeUnlink(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err;
  }
}

/** Remove a file, ignoring ALL errors. Use only in best-effort cleanup (shutdown, emergency). */
export function safeUnlinkQuiet(filePath: string): void {
  try { fs.unlinkSync(filePath); } catch {}
}

// ─── Process ───────────────────────────────────────────────────

/** Send a signal to a process, ignoring ESRCH (already dead). Rethrows other errors. */
export function safeKill(pid: number, signal: NodeJS.Signals | number): void {
  try {
    process.kill(pid, signal);
  } catch (err: any) {
    if (err?.code !== 'ESRCH') throw err;
  }
}

/**
 * Probe whether a PID exists without flattening permission/runtime failures into
 * "dead". Destructive callers must only recover automatically from `dead`.
 */
export function probeProcessLiveness(
  pid: number,
  options: ProcessProbeOptions = {},
): ProcessLiveness {
  if (!Number.isInteger(pid) || pid <= 0) return 'dead';
  const platform = options.platform ?? process.platform;
  if (platform === 'win32') {
    return probeWindowsProcess(pid, options.spawnSync ?? Bun.spawnSync);
  }
  try {
    (options.kill ?? process.kill)(pid, 0);
    return 'alive';
  } catch (err: any) {
    if (err?.code === 'ESRCH') return 'dead';
    return 'unknown';
  }
}

/**
 * Compatibility predicate for non-destructive polling. `unknown` is treated as
 * possibly alive so callers never erase state merely because a sandbox denied
 * the probe (for example POSIX `EPERM`).
 */
export function isProcessAlive(pid: number): boolean {
  return probeProcessLiveness(pid) !== 'dead';
}

/**
 * Stable OS process identity used to defend against PID reuse. Empty means the
 * runtime could not prove identity and callers must fail closed before signal.
 */
export function readProcessStartTime(
  pid: number,
  options: ProcessProbeOptions = {},
): string {
  if (probeProcessLiveness(pid, options) === 'dead') return '';
  const platform = options.platform ?? process.platform;
  const spawnSync = options.spawnSync ?? Bun.spawnSync;
  try {
    const command = platform === 'win32'
      ? [
          'powershell.exe',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `[System.Diagnostics.Process]::GetProcessById(${pid}).StartTime.ToUniversalTime().Ticks`,
        ]
      : ['ps', '-p', String(pid), '-o', 'lstart='];
    const result = spawnSync(command, {
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 3000,
    });
    if (result.exitCode !== 0) return '';
    return result.stdout?.toString().trim() ?? '';
  } catch {
    return '';
  }
}
