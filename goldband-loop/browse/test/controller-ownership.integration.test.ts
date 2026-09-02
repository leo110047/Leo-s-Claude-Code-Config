import { afterEach, describe, expect, test } from 'bun:test';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { readProcessStartTime } from '../src/error-handling';
import { canStartTestServer } from './test-server';

const CLI_PATH = path.resolve(import.meta.dir, '../src/cli.ts');
const CLI_UNDER_TEST = process.env.BROWSE_CLI_UNDER_TEST;
const SERVER_PATH = path.resolve(import.meta.dir, '../src/server.ts');
const FIXTURE_SERVER = path.resolve(import.meta.dir, 'fixtures/controller-server.ts');
const FIXTURE_EMBEDDER_FAILURE = path.resolve(import.meta.dir, 'fixtures/embedder-start-failure.ts');
const tempDirs: string[] = [];
const ownedPids: number[] = [];
const describeWithLocalhost = process.platform !== 'win32' && canStartTestServer()
  ? describe
  : describe.skip;

function cliEnv(stateFile: string, extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return {
    ...env,
    BROWSE_STATE_FILE: stateFile,
    BROWSE_PARENT_PID: '0',
    ...extra,
  };
}

function runCli(
  stateFile: string,
  extraEnv: Record<string, string> = {},
  args: string[] = ['status'],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = CLI_UNDER_TEST
      ? spawn(CLI_UNDER_TEST, args, {
          env: cliEnv(stateFile, extraEnv),
          timeout: 20_000,
        })
      : spawn('bun', ['run', CLI_PATH, ...args], {
      env: cliEnv(stateFile, extraEnv),
      timeout: 20_000,
      });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function runDirectServer(
  stateFile: string,
  extraEnv: Record<string, string> = {},
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('bun', ['run', SERVER_PATH], {
      env: cliEnv(stateFile, { BROWSE_HEADLESS_SKIP: '1', ...extraEnv }),
      timeout: 20_000,
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('close', (code) => resolve({ code: code ?? 1, stderr }));
  });
}

function runEmbedderStartFailure(
  stateFile: string,
  extraEnv: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('bun', ['run', FIXTURE_EMBEDDER_FAILURE], {
      env: cliEnv(stateFile, extraEnv),
      timeout: 20_000,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function reservePort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('failed to reserve port');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

afterEach(async () => {
  for (const pid of ownedPids.splice(0)) {
    try { process.kill(pid, 'SIGTERM'); } catch {}
  }
  await Bun.sleep(100);
  for (const dir of tempDirs.splice(0)) {
    const agentRecord = path.join(dir, 'terminal-agent-pid');
    try {
      const record = JSON.parse(fs.readFileSync(agentRecord, 'utf-8'));
      if (Number.isInteger(record.pid)) process.kill(record.pid, 'SIGTERM');
    } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describeWithLocalhost('controller ownership integration', () => {
  test('unreachable owner is preserved and a host retry reuses the same instance', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browse-owner-retry-'));
    tempDirs.push(dir);
    const stateFile = path.join(dir, 'browse.json');
    const port = await reservePort();
    const instanceId = 'existing-headed-owner';
    const original = {
      pid: process.pid,
      port,
      token: 'existing-owner-token-0123456789',
      startedAt: '2026-09-02T00:00:00.000Z',
      serverPath: '/test/existing-server.ts',
      instanceId,
      processStartTime: readProcessStartTime(process.pid),
      phase: 'ready',
      mode: 'headed',
    };
    fs.writeFileSync(stateFile, JSON.stringify(original, null, 2));
    const before = fs.readFileSync(stateFile, 'utf-8');

    const sandboxAttempt = await runCli(stateFile);
    expect(sandboxAttempt.code).toBe(1);
    expect(sandboxAttempt.stderr).toContain('State preserved');
    expect(fs.readFileSync(stateFile, 'utf-8')).toBe(before);

    const hostServer = http.createServer((request, response) => {
      if (request.url === '/health') {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ status: 'healthy', instanceId }));
        return;
      }
      if (request.url === '/command') {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ instanceId }));
        return;
      }
      response.writeHead(404).end();
    });
    await new Promise<void>((resolve, reject) => {
      hostServer.once('error', reject);
      hostServer.listen(port, '127.0.0.1', resolve);
    });
    try {
      const hostRetry = await runCli(stateFile);
      expect(hostRetry.code).toBe(0);
      expect(JSON.parse(hostRetry.stdout)).toEqual({ instanceId });
      expect(fs.readFileSync(stateFile, 'utf-8')).toBe(before);
    } finally {
      await new Promise<void>((resolve) => hostServer.close(() => resolve()));
    }
  }, 30_000);

  test('parallel normal invocations converge on one PID, port, token, and instanceId', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browse-owner-parallel-'));
    tempDirs.push(dir);
    const stateFile = path.join(dir, 'browse.json');
    const results = await Promise.all(Array.from({ length: 8 }, () => runCli(stateFile, {
      BROWSE_SERVER_SCRIPT: FIXTURE_SERVER,
    })));

    for (const result of results) {
      expect(result.code, result.stderr).toBe(0);
    }
    const owners = results.map((result) => JSON.parse(result.stdout));
    expect(new Set(owners.map((owner) => owner.instanceId)).size).toBe(1);
    expect(new Set(owners.map((owner) => owner.pid)).size).toBe(1);
    expect(new Set(owners.map((owner) => owner.port)).size).toBe(1);

    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    ownedPids.push(state.pid);
    expect(state.phase).toBe('ready');
    expect(state.instanceId).toBe(owners[0].instanceId);
    expect(state.pid).toBe(owners[0].pid);
    expect(state.port).toBe(owners[0].port);
    expect(typeof state.token).toBe('string');
  }, 30_000);

  test('CLI transfers its startup lock to the real server without deadlock', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browse-owner-handoff-'));
    tempDirs.push(dir);
    const stateFile = path.join(dir, 'browse.json');

    const result = await runCli(stateFile, {
      BROWSE_SERVER_SCRIPT: SERVER_PATH,
    });

    expect(result.code, result.stderr).toBe(0);
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    ownedPids.push(state.pid);
    expect(state.phase).toBe('ready');
    expect(fs.existsSync(`${stateFile}.lock`)).toBe(false);
    expect(fs.existsSync(`${stateFile}.lock.reclaim`)).toBe(false);
  }, 30_000);

  test('parallel callers reclaim dead startup and owner locks without split brain', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browse-owner-stale-locks-'));
    tempDirs.push(dir);
    const stateFile = path.join(dir, 'browse.json');
    const deadLock = JSON.stringify({
      pid: 99_999_999,
      nonce: 'dead-lock-owner',
      processStartTime: 'dead-process-start',
    });
    fs.writeFileSync(`${stateFile}.lock`, deadLock);
    fs.writeFileSync(`${stateFile}.owner-lock`, deadLock);

    const results = await Promise.all(Array.from({ length: 8 }, () => runCli(stateFile, {
      BROWSE_SERVER_SCRIPT: FIXTURE_SERVER,
    })));
    for (const result of results) expect(result.code, result.stderr).toBe(0);

    const owners = results.map((result) => JSON.parse(result.stdout));
    expect(new Set(owners.map((owner) => owner.instanceId)).size).toBe(1);
    expect(new Set(owners.map((owner) => owner.pid)).size).toBe(1);
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    ownedPids.push(state.pid);
    expect(state.instanceId).toBe(owners[0].instanceId);
    expect(fs.existsSync(`${stateFile}.lock.reclaim`)).toBe(false);
    expect(fs.existsSync(`${stateFile}.owner-lock.reclaim`)).toBe(false);
  }, 30_000);

  test('parallel connect invocations publish one headed controller owner', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browse-owner-connect-'));
    tempDirs.push(dir);
    const stateFile = path.join(dir, 'browse.json');
    const results = await Promise.all(Array.from({ length: 4 }, () => runCli(
      stateFile,
      { BROWSE_SERVER_SCRIPT: FIXTURE_SERVER },
      ['connect'],
    )));

    for (const result of results) {
      expect(result.code, result.stderr).toBe(0);
    }
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    ownedPids.push(state.pid);
    expect(state.mode).toBe('headed');
    expect(state.phase).toBe('ready');
    expect(results.filter((result) => result.stdout.includes('Launching headed')).length).toBe(1);
    expect(results.filter((result) => result.stdout.includes('Already connected')).length).toBe(3);
  }, 30_000);

  test('explicit connect stops the verified owner before publishing the headed replacement', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browse-owner-switch-'));
    tempDirs.push(dir);
    const stateFile = path.join(dir, 'browse.json');
    const env = { BROWSE_SERVER_SCRIPT: FIXTURE_SERVER };

    const initial = await runCli(stateFile, env);
    expect(initial.code, initial.stderr).toBe(0);
    const firstState = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));

    const connected = await runCli(stateFile, env, ['connect']);
    expect(connected.code, connected.stderr).toBe(0);
    const secondState = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    ownedPids.push(secondState.pid);

    expect(secondState.mode).toBe('headed');
    expect(secondState.instanceId).not.toBe(firstState.instanceId);
    expect(secondState.pid).not.toBe(firstState.pid);
    expect(() => process.kill(firstState.pid, 0)).toThrow();
  }, 30_000);

  test('a direct server loser cannot delete the winning owner state on exit', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browse-owner-loser-'));
    tempDirs.push(dir);
    const stateFile = path.join(dir, 'browse.json');
    const env = { BROWSE_SERVER_SCRIPT: FIXTURE_SERVER };
    const initial = await runCli(stateFile, env);
    expect(initial.code, initial.stderr).toBe(0);
    const before = fs.readFileSync(stateFile, 'utf-8');
    const winner = JSON.parse(before);
    ownedPids.push(winner.pid);

    const loser = await runDirectServer(stateFile);
    expect(loser.code).not.toBe(0);
    expect(loser.stderr).toContain('Existing controller ownership is healthy');
    expect(fs.readFileSync(stateFile, 'utf-8')).toBe(before);

    const reused = await runCli(stateFile, env);
    expect(reused.code, reused.stderr).toBe(0);
    expect(JSON.parse(reused.stdout).instanceId).toBe(winner.instanceId);
  }, 30_000);

  test('an embedder can catch start failure only after its reservation is removed', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browse-owner-embedder-failure-'));
    tempDirs.push(dir);
    const stateFile = path.join(dir, 'browse.json');

    const result = await runEmbedderStartFailure(stateFile);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('embedder observed cleanup: fixture listener bind failure');
    expect(fs.existsSync(stateFile)).toBe(false);
  }, 30_000);

  test('startup rollback preserves its reservation when compare-delete is blocked', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browse-owner-embedder-fail-closed-'));
    tempDirs.push(dir);
    const stateFile = path.join(dir, 'browse.json');

    const result = await runEmbedderStartFailure(stateFile, {
      BROWSE_FIXTURE_BLOCK_RESERVATION_DELETE: '1',
    });
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('embedder observed fail-closed reservation');
    expect(result.stdout).toContain('reservation could not be removed');
    expect(fs.existsSync(stateFile)).toBe(true);
  }, 30_000);

  test('startup rollback preserves its reservation when Chromium stop is unconfirmed', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browse-owner-browser-rollback-'));
    tempDirs.push(dir);
    const stateFile = path.join(dir, 'browse.json');

    const result = await runEmbedderStartFailure(stateFile, {
      BROWSE_FIXTURE_STRICT_CLOSE_FAILURE: '1',
    });
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('embedder observed fail-closed reservation');
    expect(result.stdout).toContain('rollback was incomplete');
    expect(fs.existsSync(stateFile)).toBe(true);
  }, 30_000);

  test('startup rollback treats Playwright without a process handle as unknown', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browse-owner-no-process-handle-'));
    tempDirs.push(dir);
    const stateFile = path.join(dir, 'browse.json');

    const result = await runEmbedderStartFailure(stateFile, {
      BROWSE_FIXTURE_NO_PROCESS_HANDLE: '1',
    });
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('embedder observed fail-closed reservation');
    expect(result.stdout).toContain('rollback was incomplete');
    expect(fs.existsSync(stateFile)).toBe(true);
  }, 30_000);

  test('connect preserves a profile lock whose process is not confirmed dead', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browse-profile-owner-'));
    tempDirs.push(dir);
    const stateFile = path.join(dir, 'browse.json');
    const profileDir = path.join(dir, '.goldband', 'chromium-profile');
    fs.mkdirSync(profileDir, { recursive: true });
    const singletonLock = path.join(profileDir, 'SingletonLock');
    fs.symlinkSync(`${os.hostname()}-${process.pid}`, singletonLock);
    const deadState = {
      pid: 99_999_999,
      port: await reservePort(),
      token: 'dead-controller-token-0123456789',
      startedAt: '2026-09-02T00:00:00.000Z',
      serverPath: '/test/dead-server.ts',
      instanceId: 'dead-controller',
      processStartTime: 'dead-process-start',
      phase: 'ready',
      mode: 'headed',
    };
    fs.writeFileSync(stateFile, JSON.stringify(deadState, null, 2));
    const before = fs.readFileSync(stateFile, 'utf-8');

    const result = await runCli(stateFile, {
      HOME: dir,
      CHROMIUM_PROFILE: profileDir,
      BROWSE_SERVER_SCRIPT: FIXTURE_SERVER,
    }, ['connect']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Chromium profile is still owned or unverifiable');
    expect(fs.readlinkSync(singletonLock)).toBe(`${os.hostname()}-${process.pid}`);
    expect(fs.readFileSync(stateFile, 'utf-8')).toBe(before);
  }, 30_000);

  test('normal autostart preserves a dead headed state while its profile owner is live', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browse-profile-autostart-'));
    tempDirs.push(dir);
    const stateFile = path.join(dir, 'browse.json');
    const profileDir = path.join(dir, '.goldband', 'chromium-profile');
    fs.mkdirSync(profileDir, { recursive: true });
    const singletonLock = path.join(profileDir, 'SingletonLock');
    fs.symlinkSync(`${os.hostname()}-${process.pid}`, singletonLock);
    const deadState = {
      pid: 99_999_999,
      port: await reservePort(),
      token: 'dead-headed-token-0123456789',
      startedAt: '2026-09-02T00:00:00.000Z',
      serverPath: '/test/dead-server.ts',
      instanceId: 'dead-headed-owner',
      processStartTime: 'dead-process-start',
      phase: 'ready',
      mode: 'headed',
    };
    fs.writeFileSync(stateFile, JSON.stringify(deadState, null, 2));
    const before = fs.readFileSync(stateFile, 'utf-8');

    const result = await runCli(stateFile, {
      HOME: dir,
      CHROMIUM_PROFILE: profileDir,
      BROWSE_SERVER_SCRIPT: FIXTURE_SERVER,
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Chromium profile is still owned or unverifiable');
    expect(fs.readlinkSync(singletonLock)).toBe(`${os.hostname()}-${process.pid}`);
    expect(fs.readFileSync(stateFile, 'utf-8')).toBe(before);
  }, 30_000);

  test('direct server preserves a dead headed state while its profile owner is live', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browse-profile-direct-'));
    tempDirs.push(dir);
    const stateFile = path.join(dir, 'browse.json');
    const profileDir = path.join(dir, '.goldband', 'chromium-profile');
    fs.mkdirSync(profileDir, { recursive: true });
    const singletonLock = path.join(profileDir, 'SingletonLock');
    fs.symlinkSync(`${os.hostname()}-${process.pid}`, singletonLock);
    const deadState = {
      pid: 99_999_999,
      port: await reservePort(),
      token: 'dead-direct-token-0123456789',
      startedAt: '2026-09-02T00:00:00.000Z',
      serverPath: '/test/dead-server.ts',
      instanceId: 'dead-direct-owner',
      processStartTime: 'dead-process-start',
      phase: 'ready',
      mode: 'headed',
    };
    fs.writeFileSync(stateFile, JSON.stringify(deadState, null, 2));
    const before = fs.readFileSync(stateFile, 'utf-8');

    const result = await runDirectServer(stateFile, {
      HOME: dir,
      CHROMIUM_PROFILE: profileDir,
    });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('Chromium profile is still owned or unverifiable');
    expect(fs.readlinkSync(singletonLock)).toBe(`${os.hostname()}-${process.pid}`);
    expect(fs.readFileSync(stateFile, 'utf-8')).toBe(before);
    expect(fs.existsSync(`${stateFile}.lock`)).toBe(false);
  }, 30_000);

  test('normal autostart preserves a state with incomplete Xvfb identity', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browse-partial-xvfb-'));
    tempDirs.push(dir);
    const stateFile = path.join(dir, 'browse.json');
    const deadState = {
      pid: 99_999_999,
      port: await reservePort(),
      token: 'partial-xvfb-token-0123456789',
      startedAt: '2026-09-02T00:00:00.000Z',
      serverPath: '/test/dead-server.ts',
      instanceId: 'partial-xvfb-owner',
      processStartTime: 'dead-process-start',
      phase: 'ready',
      mode: 'headed',
      xvfbPid: process.pid,
      xvfbDisplay: ':99',
    };
    fs.writeFileSync(stateFile, JSON.stringify(deadState, null, 2));
    const before = fs.readFileSync(stateFile, 'utf-8');

    const result = await runCli(stateFile, {
      HOME: dir,
      BROWSE_SERVER_SCRIPT: FIXTURE_SERVER,
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Recorded Xvfb identity is incomplete');
    expect(fs.readFileSync(stateFile, 'utf-8')).toBe(before);
  }, 30_000);
});
