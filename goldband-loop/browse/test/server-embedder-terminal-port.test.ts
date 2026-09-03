import { describe, test, expect, beforeEach, beforeAll, afterAll } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  buildFetchHandler,
  __resetShuttingDown,
  type ServerConfig,
} from '../src/server';
import { __resetRegistry } from '../src/token-registry';
import { BrowserManager } from '../src/browser-manager';
import { resolveConfig } from '../src/config';
import { controllerOwner, type ControllerState } from '../src/controller-state';

// Tests for the v1.41+ ownsTerminalAgent flag.
//
// Embedders (gbrowser phoenix overlay) that run their own PTY server and write
// terminal-port / terminal-internal-token / terminal-agent-pid themselves were
// getting those files clobbered by goldband's shutdown(). Cleanup now requires
// BOTH a matching controller owner and this flag (default true). Together they
// gate four side effects (v1.44+):
//   1. identity-based kill of the PID in <stateDir>/terminal-agent-pid
//   2. unlink terminal-port
//   3. unlink terminal-internal-token
//   4. unlink terminal-agent-pid
// False or no matching controller owner = goldband stays hands-off.
//
// Pre-v1.44 used `pkill -f terminal-agent\.ts` which matched sibling goldband
// sessions on the same host — see browse/src/terminal-agent-control.ts header.
//
// CRITICAL: each test stubs process.exit (so shutdown's exit doesn't kill
// the test runner). The PID in the test agent-record is a guaranteed-dead
// PID (1 = init / launchd — exists but cannot be killed by an unprivileged
// process, so safeKill returns ESRCH-equivalent without affecting anything).
// Use isProcessAlive's false branch by also testing with a PID that does
// not exist (negative PID rejected by the OS).

const stateDir = resolveConfig().stateDir;
const PORT_FILE = path.join(stateDir, 'terminal-port');
const TOKEN_FILE = path.join(stateDir, 'terminal-internal-token');
const AGENT_RECORD_FILE = path.join(stateDir, 'terminal-agent-pid');
const SENTINEL_PORT = 'sentinel-port-65432';
const SENTINEL_TOKEN = 'sentinel-token-abcdef1234567890';
// PID 2^31-1 is the Linux PID_MAX_LIMIT; macOS uses 99998. Either way, no
// real process will ever hold this PID on a developer machine. isProcessAlive
// returns false → killAgentByRecord no-ops without sending any signal.
const SENTINEL_DEAD_PID = 2147483646;

function makeMinimalConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const token = 'embedder-test-' + crypto.randomBytes(16).toString('hex');
  return {
    authToken: token,
    browsePort: 34568,
    idleTimeoutMs: 1_800_000,
    config: resolveConfig(),
    browserManager: new BrowserManager(),
    startTime: Date.now(),
    ...overrides,
  };
}

function writeSentinels(): void {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(PORT_FILE, SENTINEL_PORT);
  fs.writeFileSync(TOKEN_FILE, SENTINEL_TOKEN);
  fs.writeFileSync(
    AGENT_RECORD_FILE,
    JSON.stringify({ pid: SENTINEL_DEAD_PID, gen: 'sentinel-gen', startedAt: Date.now() }),
  );
}

function readIfExists(p: string): string | null {
  try { return fs.readFileSync(p, 'utf-8'); } catch { return null; }
}

/**
 * Stubs process.exit so shutdown()'s process.exit(0) throws an __exit:N
 * marker the test can swallow instead of killing the runner. Also stubs
 * process.kill so an accidental kill (regression in killAgentByRecord
 * that bypassed isProcessAlive) cannot reach a real PID on the developer
 * machine. Returns the captured kill calls so tests can assert kill
 * scope.
 */
async function withStubs(
  cb: (killCalls: Array<[number, NodeJS.Signals | number]>) => Promise<void>
): Promise<Array<[number, NodeJS.Signals | number]>> {
  const origExit = process.exit;
  const origKill = process.kill;
  const killCalls: Array<[number, NodeJS.Signals | number]> = [];
  (process as any).exit = ((code: number) => {
    throw new Error(`__exit:${code}`);
  }) as any;
  (process as any).kill = ((pid: number, signal: NodeJS.Signals | number) => {
    killCalls.push([pid, signal ?? 'SIGTERM']);
    // signal 0 is a liveness probe — keep the existing 'process is dead'
    // semantics so isProcessAlive(SENTINEL_DEAD_PID) returns false.
    if (signal === 0) {
      const err: any = new Error('No such process');
      err.code = 'ESRCH';
      throw err;
    }
    return true;
  }) as any;
  try {
    await cb(killCalls);
  } finally {
    (process as any).exit = origExit;
    (process as any).kill = origKill;
  }
  return killCalls;
}

async function runShutdown(handle: { shutdown: (code?: number) => Promise<void> }): Promise<void> {
  try {
    await handle.shutdown(0);
  } catch (err: any) {
    if (typeof err?.message !== 'string' || !err.message.startsWith('__exit:')) throw err;
  }
}

// Filter out the signal=0 liveness probes; only count actual termination signals.
function terminationCalls(
  calls: Array<[number, NodeJS.Signals | number]>,
): Array<[number, NodeJS.Signals | number]> {
  return calls.filter(([, sig]) => sig !== 0);
}

describe('buildFetchHandler ownsTerminalAgent gate', () => {
  // These tests use the default config state dir to cover the exact historical
  // shared-file path. Save and restore any real-daemon discovery files so the
  // suite never clobbers a developer's running session.
  let realPortBackup: string | null = null;
  let realTokenBackup: string | null = null;
  let realAgentRecordBackup: string | null = null;

  beforeAll(() => {
    realPortBackup = readIfExists(PORT_FILE);
    realTokenBackup = readIfExists(TOKEN_FILE);
    realAgentRecordBackup = readIfExists(AGENT_RECORD_FILE);
  });

  afterAll(() => {
    if (realPortBackup !== null) {
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(PORT_FILE, realPortBackup);
    } else {
      try { fs.unlinkSync(PORT_FILE); } catch {}
    }
    if (realTokenBackup !== null) {
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(TOKEN_FILE, realTokenBackup);
    } else {
      try { fs.unlinkSync(TOKEN_FILE); } catch {}
    }
    if (realAgentRecordBackup !== null) {
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(AGENT_RECORD_FILE, realAgentRecordBackup);
    } else {
      try { fs.unlinkSync(AGENT_RECORD_FILE); } catch {}
    }
  });

  beforeEach(() => {
    __resetRegistry();
    __resetShuttingDown();
    // Clean any leftover sentinels from a prior failed run so the "preserved"
    // assertion can't pass spuriously off a stale file.
    try { fs.unlinkSync(PORT_FILE); } catch {}
    try { fs.unlinkSync(TOKEN_FILE); } catch {}
    try { fs.unlinkSync(AGENT_RECORD_FILE); } catch {}
  });

  test('1. ownsTerminalAgent:false preserves all three files and sends no signal', async () => {
    writeSentinels();
    const handle = buildFetchHandler(makeMinimalConfig({ ownsTerminalAgent: false }));
    const calls = await withStubs(async () => {
      await runShutdown(handle);
    });
    expect(readIfExists(PORT_FILE)).toBe(SENTINEL_PORT);
    expect(readIfExists(TOKEN_FILE)).toBe(SENTINEL_TOKEN);
    expect(readIfExists(AGENT_RECORD_FILE)).not.toBeNull();
    expect(terminationCalls(calls).length).toBe(0);
  });

  test('2. ownerless embedder preserves shared files even when ownsTerminalAgent:true', async () => {
    writeSentinels();
    const handle = buildFetchHandler(makeMinimalConfig({ ownsTerminalAgent: true }));
    const calls = await withStubs(async () => {
      await runShutdown(handle);
    });
    expect(readIfExists(PORT_FILE)).toBe(SENTINEL_PORT);
    expect(readIfExists(TOKEN_FILE)).toBe(SENTINEL_TOKEN);
    expect(readIfExists(AGENT_RECORD_FILE)).not.toBeNull();
    expect(calls.length).toBe(0);
    expect(terminationCalls(calls).length).toBe(0);
  });

  test('3. ownerless embedder default also preserves shared files', async () => {
    writeSentinels();
    // Note: no ownsTerminalAgent in the overrides — uses the `?? true` default.
    const handle = buildFetchHandler(makeMinimalConfig());
    const calls = await withStubs(async () => {
      await runShutdown(handle);
    });
    expect(readIfExists(PORT_FILE)).toBe(SENTINEL_PORT);
    expect(readIfExists(TOKEN_FILE)).toBe(SENTINEL_TOKEN);
    expect(readIfExists(AGENT_RECORD_FILE)).not.toBeNull();
    expect(calls.length).toBe(0);
  });

  test('4. CLI start() call site passes ownsTerminalAgent: true literally (static grep)', () => {
    // Resolves browse/src/server.ts relative to this test file so the test
    // works regardless of cwd. import.meta.url is the test file's URL.
    const serverTsPath = path.resolve(
      new URL(import.meta.url).pathname,
      '..',
      '..',
      'src',
      'server.ts',
    );
    const source = fs.readFileSync(serverTsPath, 'utf-8');
    // Match the call site inside start()'s buildFetchHandler({...}) literal.
    // The pattern looks for the trailing comma and trailing context so the
    // match cannot be satisfied by the JSDoc reference earlier in the file.
    expect(source).toMatch(/ownsTerminalAgent:\s*true,\s*\/\/\s*CLI spawns terminal-agent\.ts/);
  });
});

describe('buildFetchHandler shutdown ownership safety', () => {
  function makeOwnedShutdownFixture(dir: string, manager: BrowserManager) {
    const stateFile = path.join(dir, 'browse.json');
    const profileDir = path.join(dir, 'chromium-profile');
    fs.mkdirSync(profileDir, { recursive: true });
    const lockPath = path.join(profileDir, 'SingletonLock');
    fs.symlinkSync(`${os.hostname()}-${process.pid}`, lockPath);
    const ownerState: ControllerState = {
      pid: process.pid,
      port: 34568,
      token: 'shutdown-owner-token-0123456789',
      startedAt: '2026-09-02T00:00:00.000Z',
      serverPath: '/test/server.ts',
      instanceId: 'shutdown-owner',
      phase: 'ready',
      mode: 'headed',
    };
    fs.writeFileSync(stateFile, JSON.stringify(ownerState));
    const baseConfig = resolveConfig();
    return {
      stateFile,
      profileDir,
      lockPath,
      ownerState,
      config: makeMinimalConfig({
        config: {
          ...baseConfig,
          projectDir: dir,
          stateDir: dir,
          stateFile,
          consoleLog: path.join(dir, 'console.log'),
          networkLog: path.join(dir, 'network.log'),
          dialogLog: path.join(dir, 'dialog.log'),
          auditLog: path.join(dir, 'audit.log'),
        },
        browserManager: manager,
        chromiumProfile: profileDir,
        controllerOwner: controllerOwner(ownerState),
        ownsTerminalAgent: false,
      }),
    };
  }

  test('close rejection preserves controller state and live profile locks', async () => {
    __resetRegistry();
    __resetShuttingDown();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browse-shutdown-owner-'));
    const manager = new BrowserManager();
    manager.close = async () => { throw new Error('fixture close rejected'); };
    const fixture = makeOwnedShutdownFixture(dir, manager);
    const handle = buildFetchHandler(fixture.config);

    try {
      await expect(handle.shutdown(0)).rejects.toThrow('ownership state and profile locks were preserved');
      expect(fs.readFileSync(fixture.stateFile, 'utf-8')).toBe(JSON.stringify(fixture.ownerState));
      expect(fs.readlinkSync(fixture.lockPath)).toBe(`${os.hostname()}-${process.pid}`);
    } finally {
      __resetShuttingDown();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('live profile lock blocks state deletion even after browser close succeeds', async () => {
    __resetRegistry();
    __resetShuttingDown();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browse-shutdown-lock-'));
    const fixture = makeOwnedShutdownFixture(dir, new BrowserManager());
    const handle = buildFetchHandler(fixture.config);

    try {
      await expect(handle.shutdown(0)).rejects.toThrow('ownership state and profile locks were preserved');
      expect(fs.readFileSync(fixture.stateFile, 'utf-8')).toBe(JSON.stringify(fixture.ownerState));
      expect(fs.readlinkSync(fixture.lockPath)).toBe(`${os.hostname()}-${process.pid}`);
    } finally {
      __resetShuttingDown();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('unconfirmed owned Xvfb stop preserves controller state and profile locks', async () => {
    __resetRegistry();
    __resetShuttingDown();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browse-shutdown-xvfb-'));
    const fixture = makeOwnedShutdownFixture(dir, new BrowserManager());
    fixture.config.xvfb = {
      pid: 4242,
      startTime: 'fixture-start',
      display: ':99',
      close: () => {},
      closeStrict: async () => { throw new Error('fixture Xvfb stop unknown'); },
    };
    fixture.config.ownsXvfb = true;
    const handle = buildFetchHandler(fixture.config);

    try {
      await expect(handle.shutdown(0)).rejects.toThrow('ownership state and profile locks were preserved');
      expect(fs.readFileSync(fixture.stateFile, 'utf-8')).toBe(JSON.stringify(fixture.ownerState));
      expect(fs.readlinkSync(fixture.lockPath)).toBe(`${os.hostname()}-${process.pid}`);
    } finally {
      __resetShuttingDown();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
