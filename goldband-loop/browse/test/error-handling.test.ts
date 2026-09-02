import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  safeUnlink,
  safeKill,
  isProcessAlive,
  probeProcessLiveness,
  readProcessStartTime,
} from '../src/error-handling';

describe('safeUnlink', () => {
  test('removes an existing file', () => {
    const tmp = path.join(os.tmpdir(), `test-safeUnlink-${Date.now()}`);
    fs.writeFileSync(tmp, 'hello');
    safeUnlink(tmp);
    expect(fs.existsSync(tmp)).toBe(false);
  });

  test('ignores ENOENT (file does not exist)', () => {
    expect(() => safeUnlink('/tmp/nonexistent-file-' + Date.now())).not.toThrow();
  });

  test('rethrows non-ENOENT errors', () => {
    // Attempt to unlink a directory — throws EPERM/EISDIR
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-safeUnlink-'));
    expect(() => safeUnlink(dir)).toThrow();
    fs.rmdirSync(dir);
  });
});

describe('safeKill', () => {
  test('sends signal to a running process', () => {
    // signal 0 is a no-op existence check — safe to send to self
    expect(() => safeKill(process.pid, 0)).not.toThrow();
  });

  test('ignores ESRCH (process does not exist)', () => {
    // PID 99999999 is extremely unlikely to exist
    expect(() => safeKill(99999999, 0)).not.toThrow();
  });
});

describe('isProcessAlive', () => {
  test('returns true for current process', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  test('returns false for non-existent process', () => {
    expect(isProcessAlive(99999999)).toBe(false);
  });

  test('does not report EPERM as dead', () => {
    const permissionError = Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
    const liveness = probeProcessLiveness(1234, {
      platform: 'darwin',
      kill: () => { throw permissionError; },
    });
    expect(liveness).toBe('unknown');
  });

  test('reports only ESRCH as dead on POSIX', () => {
    const missingError = Object.assign(new Error('no such process'), { code: 'ESRCH' });
    expect(probeProcessLiveness(1234, {
      platform: 'linux',
      kill: () => { throw missingError; },
    })).toBe('dead');
  });

  test('uses tasklist output without flattening Windows probe failures', () => {
    const spawnResult = (exitCode: number, stdout: string) => (() => ({
      exitCode,
      stdout: Buffer.from(stdout),
      stderr: Buffer.from(''),
    })) as unknown as typeof Bun.spawnSync;

    expect(probeProcessLiveness(1234, {
      platform: 'win32',
      spawnSync: spawnResult(0, '"bun.exe","1234","Console","1","10,000 K"'),
    })).toBe('alive');
    expect(probeProcessLiveness(1234, {
      platform: 'win32',
      spawnSync: spawnResult(0, 'INFO: No tasks are running which match the specified criteria.'),
    })).toBe('dead');
    expect(probeProcessLiveness(1234, {
      platform: 'win32',
      spawnSync: spawnResult(1, ''),
    })).toBe('unknown');
  });

  test('reads a stable start time through the injected process seam', () => {
    const fakeSpawn = (() => ({
      exitCode: 0,
      stdout: Buffer.from('Mon Sep  2 10:00:00 2026\n'),
      stderr: Buffer.from(''),
    })) as unknown as typeof Bun.spawnSync;
    expect(readProcessStartTime(1234, {
      platform: 'darwin',
      kill: () => {},
      spawnSync: fakeSpawn,
    })).toBe('Mon Sep  2 10:00:00 2026');
  });
});
