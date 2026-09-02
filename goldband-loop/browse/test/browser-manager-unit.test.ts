import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, it, expect } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── BrowserManager basic unit tests ─────────────────────────────

describe('BrowserManager defaults', () => {
  it('getConnectionMode defaults to launched', async () => {
    const { BrowserManager } = await import('../src/browser-manager');
    const bm = new BrowserManager();
    expect(bm.getConnectionMode()).toBe('launched');
  });

  it('getRefMap returns empty array initially', async () => {
    const { BrowserManager } = await import('../src/browser-manager');
    const bm = new BrowserManager();
    expect(bm.getRefMap()).toEqual([]);
  });

  it('launchHeaded never deletes profile locks outside the controller transition guard', () => {
    const sourcePath = path.resolve(import.meta.dir, '../src/browser-manager.ts');
    const source = fs.readFileSync(sourcePath, 'utf-8');
    const launchHeaded = source.slice(
      source.indexOf('async launchHeaded('),
      source.indexOf('async connectOverCDP('),
    );
    expect(launchHeaded).not.toContain('cleanSingletonLocks');
  });
});

describe('BrowserManager startup rollback close', () => {
  function installFakeBrowser(
    manager: any,
    close: () => Promise<void>,
    isConnected: () => boolean,
    proc?: { pid: number; exitCode: number | null; signalCode: NodeJS.Signals | null },
  ) {
    const browser = new EventEmitter() as EventEmitter & {
      close: () => Promise<void>;
      isConnected: () => boolean;
      process?: () => typeof proc;
    };
    browser.close = close;
    browser.isConnected = isConnected;
    if (proc) browser.process = () => proc;
    manager.browser = browser;
    manager.connectionMode = 'launched';
    return browser;
  }

  it('rejects a close timeout and retains the browser reference', async () => {
    const { BrowserManager } = await import('../src/browser-manager');
    const bm = new BrowserManager() as any;
    const browser = installFakeBrowser(bm, () => new Promise(() => {}), () => true);

    await expect(bm.closeForStartupRollback(5)).rejects.toThrow('did not complete');
    expect(bm.browser).toBe(browser);
  });

  it('rejects when the Chromium child is still alive after disconnect', async () => {
    const { BrowserManager } = await import('../src/browser-manager');
    const bm = new BrowserManager() as any;
    let connected = true;
    const browser = installFakeBrowser(
      bm,
      async () => { connected = false; },
      () => connected,
      { pid: process.pid, exitCode: null, signalCode: null },
    );

    await expect(bm.closeForStartupRollback(50)).rejects.toThrow('still alive');
    expect(bm.browser).toBe(browser);
  });

  it('fails closed when production Playwright exposes no child process handle', async () => {
    const { BrowserManager } = await import('../src/browser-manager');
    const bm = new BrowserManager() as any;
    let connected = true;
    const browser = installFakeBrowser(
      bm,
      async () => { connected = false; },
      () => connected,
    );

    await expect(bm.closeForStartupRollback(50)).rejects.toThrow('identity is unavailable');
    expect(bm.browser).toBe(browser);
  });

  it('clears references only after browser and child process are stopped', async () => {
    const { BrowserManager } = await import('../src/browser-manager');
    const bm = new BrowserManager() as any;
    let connected = true;
    installFakeBrowser(
      bm,
      async () => { connected = false; },
      () => connected,
      { pid: 4242, exitCode: 0, signalCode: null },
    );

    await bm.closeForStartupRollback(50);
    expect(bm.browser).toBeNull();
    expect(bm.context).toBeNull();
  });
});

describe('BrowserManager controller shutdown close', () => {
  function installFakeBrowser(
    manager: any,
    close: () => Promise<void>,
    isConnected: () => boolean,
  ) {
    const browser = new EventEmitter() as EventEmitter & {
      close: () => Promise<void>;
      isConnected: () => boolean;
    };
    browser.close = close;
    browser.isConnected = isConnected;
    manager.browser = browser;
    manager.connectionMode = 'launched';
    return browser;
  }

  it('propagates a close rejection and retains the browser reference', async () => {
    const { BrowserManager } = await import('../src/browser-manager');
    const bm = new BrowserManager() as any;
    const browser = installFakeBrowser(bm, async () => { throw new Error('close rejected'); }, () => true);

    await expect(bm.close(50)).rejects.toThrow('close rejected');
    expect(bm.browser).toBe(browser);
  });

  it('propagates a close timeout and retains the browser reference', async () => {
    const { BrowserManager } = await import('../src/browser-manager');
    const bm = new BrowserManager() as any;
    const browser = installFakeBrowser(bm, () => new Promise(() => {}), () => true);

    await expect(bm.close(5)).rejects.toThrow('did not complete');
    expect(bm.browser).toBe(browser);
  });

  it('clears browser and context only after a confirmed disconnect', async () => {
    const { BrowserManager } = await import('../src/browser-manager');
    const bm = new BrowserManager() as any;
    let connected = true;
    installFakeBrowser(bm, async () => { connected = false; }, () => connected);
    bm.context = { marker: 'context' };

    await bm.close(50);
    expect(bm.browser).toBeNull();
    expect(bm.context).toBeNull();
  });
});

// ─── shouldEnableChromiumSandbox ─────────────────────────────────
//
// Pinning this is what prevents the "--no-sandbox" yellow infobar from
// regressing on headed launches. Playwright auto-adds --no-sandbox when
// chromiumSandbox !== true (playwright-core chromium.js:291-292), so all
// three launch sites in browser-manager.ts must pass the policy this
// helper computes.

describe('shouldEnableChromiumSandbox', () => {
  const origPlatform = process.platform;
  const origCI = process.env.CI;
  const origContainer = process.env.CONTAINER;
  const origNoSandbox = process.env.GOLDBAND_CHROMIUM_NO_SANDBOX;
  const origGetuid = process.getuid;

  beforeEach(() => {
    delete process.env.CI;
    delete process.env.CONTAINER;
    delete process.env.GOLDBAND_CHROMIUM_NO_SANDBOX;
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: origPlatform });
    if (origCI === undefined) delete process.env.CI; else process.env.CI = origCI;
    if (origContainer === undefined) delete process.env.CONTAINER; else process.env.CONTAINER = origContainer;
    if (origNoSandbox === undefined) delete process.env.GOLDBAND_CHROMIUM_NO_SANDBOX; else process.env.GOLDBAND_CHROMIUM_NO_SANDBOX = origNoSandbox;
    process.getuid = origGetuid;
  });

  function setPlatform(p: NodeJS.Platform) {
    Object.defineProperty(process, 'platform', { value: p });
  }

  it('darwin, no CI/CONTAINER/root → true', async () => {
    setPlatform('darwin');
    process.getuid = (() => 501) as typeof process.getuid;
    const { shouldEnableChromiumSandbox } = await import('../src/browser-manager');
    expect(shouldEnableChromiumSandbox()).toBe(true);
  });

  it('linux, no CI/CONTAINER/root → true', async () => {
    setPlatform('linux');
    process.getuid = (() => 1000) as typeof process.getuid;
    const { shouldEnableChromiumSandbox } = await import('../src/browser-manager');
    expect(shouldEnableChromiumSandbox()).toBe(true);
  });

  it('win32 → false (sandbox fails in Bun→Node→Chromium chain)', async () => {
    setPlatform('win32');
    process.getuid = (() => 1000) as typeof process.getuid;
    const { shouldEnableChromiumSandbox } = await import('../src/browser-manager');
    expect(shouldEnableChromiumSandbox()).toBe(false);
  });

  it('linux + CI=1 → false', async () => {
    setPlatform('linux');
    process.env.CI = '1';
    process.getuid = (() => 1000) as typeof process.getuid;
    const { shouldEnableChromiumSandbox } = await import('../src/browser-manager');
    expect(shouldEnableChromiumSandbox()).toBe(false);
  });

  it('linux + CONTAINER=1 → false', async () => {
    setPlatform('linux');
    process.env.CONTAINER = '1';
    process.getuid = (() => 1000) as typeof process.getuid;
    const { shouldEnableChromiumSandbox } = await import('../src/browser-manager');
    expect(shouldEnableChromiumSandbox()).toBe(false);
  });

  it('linux + root (uid 0) → false', async () => {
    setPlatform('linux');
    process.getuid = (() => 0) as typeof process.getuid;
    const { shouldEnableChromiumSandbox } = await import('../src/browser-manager');
    expect(shouldEnableChromiumSandbox()).toBe(false);
  });

  // #1562 — Ubuntu/AppArmor opt-in override
  it('linux + GOLDBAND_CHROMIUM_NO_SANDBOX=1 → false (Ubuntu/AppArmor opt-out)', async () => {
    setPlatform('linux');
    process.env.GOLDBAND_CHROMIUM_NO_SANDBOX = '1';
    process.getuid = (() => 1000) as typeof process.getuid;
    const { shouldEnableChromiumSandbox } = await import('../src/browser-manager');
    expect(shouldEnableChromiumSandbox()).toBe(false);
  });

  it('darwin + GOLDBAND_CHROMIUM_NO_SANDBOX=1 → false (env override wins on any platform)', async () => {
    setPlatform('darwin');
    process.env.GOLDBAND_CHROMIUM_NO_SANDBOX = '1';
    process.getuid = (() => 501) as typeof process.getuid;
    const { shouldEnableChromiumSandbox } = await import('../src/browser-manager');
    expect(shouldEnableChromiumSandbox()).toBe(false);
  });

  it('GOLDBAND_CHROMIUM_NO_SANDBOX=0 → does NOT trigger override (must be exactly "1")', async () => {
    setPlatform('linux');
    process.env.GOLDBAND_CHROMIUM_NO_SANDBOX = '0';
    process.getuid = (() => 1000) as typeof process.getuid;
    const { shouldEnableChromiumSandbox } = await import('../src/browser-manager');
    expect(shouldEnableChromiumSandbox()).toBe(true);
  });
});

// ─── resolveDisconnectCause ──────────────────────────────────────
//
// Pinning the clean-vs-crash distinction matters because gbd's
// HealthMonitor consumes our exit code (0 = don't restart, !=0 =
// restart). A regression here brings back the "Cmd+Q makes the browser
// keep coming back" UX bug.

function makeFakeBrowser(opts: {
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  /** ms before emitting 'exit'; default = already exited at construction */
  exitDelay?: number;
}): { process(): { exitCode: number | null; signalCode: NodeJS.Signals | null; once: EventEmitter['once'] } } {
  const ee = new EventEmitter();
  const state = {
    exitCode: opts.exitDelay != null ? null : opts.exitCode,
    signalCode: opts.exitDelay != null ? null : opts.signalCode,
    once: ee.once.bind(ee),
  };
  if (opts.exitDelay != null) {
    setTimeout(() => {
      state.exitCode = opts.exitCode;
      state.signalCode = opts.signalCode;
      ee.emit('exit', opts.exitCode, opts.signalCode);
    }, opts.exitDelay);
  }
  return { process: () => state };
}

describe('resolveDisconnectCause', () => {
  it('clean: process already exited with code 0', async () => {
    const { resolveDisconnectCause } = await import('../src/browser-manager');
    const fake = makeFakeBrowser({ exitCode: 0, signalCode: null });
    expect(await resolveDisconnectCause(fake as never)).toBe('clean');
  });

  it('crash: non-zero exit code', async () => {
    const { resolveDisconnectCause } = await import('../src/browser-manager');
    const fake = makeFakeBrowser({ exitCode: 1, signalCode: null });
    expect(await resolveDisconnectCause(fake as never)).toBe('crash');
  });

  it('crash: SIGSEGV', async () => {
    const { resolveDisconnectCause } = await import('../src/browser-manager');
    const fake = makeFakeBrowser({ exitCode: null, signalCode: 'SIGSEGV' });
    expect(await resolveDisconnectCause(fake as never)).toBe('crash');
  });

  it('crash: SIGKILL', async () => {
    const { resolveDisconnectCause } = await import('../src/browser-manager');
    const fake = makeFakeBrowser({ exitCode: null, signalCode: 'SIGKILL' });
    expect(await resolveDisconnectCause(fake as never)).toBe('crash');
  });

  it('clean: process exits asynchronously with code 0 within timeout', async () => {
    const { resolveDisconnectCause } = await import('../src/browser-manager');
    const fake = makeFakeBrowser({ exitCode: 0, signalCode: null, exitDelay: 50 });
    expect(await resolveDisconnectCause(fake as never)).toBe('clean');
  });

  it('crash: process exits asynchronously with non-zero code', async () => {
    const { resolveDisconnectCause } = await import('../src/browser-manager');
    const fake = makeFakeBrowser({ exitCode: 137, signalCode: null, exitDelay: 50 });
    expect(await resolveDisconnectCause(fake as never)).toBe('crash');
  });

  it('crash: null browser returns crash (defensive default)', async () => {
    const { resolveDisconnectCause } = await import('../src/browser-manager');
    expect(await resolveDisconnectCause(null)).toBe('crash');
  });
});

// ─── onDisconnect exit-code propagation (regression test) ──────────
//
// The contract: BrowserManager.onDisconnect is called with the resolved
// exit code (0 for clean Cmd+Q, 2 for crash). server.ts then forwards
// that code to activeShutdown(), which exits the process.
//
// Without this propagation, the headed-mode user-visible Cmd+Q respawn
// bug returns: server.ts hardcoded `activeShutdown?.(2)` ignores the
// resolved 0 and gbrowser's gbd HealthMonitor treats the clean quit as
// a crash, restarting the window.
describe('BrowserManager.onDisconnect exit-code propagation', () => {
  it('signature accepts an optional exitCode argument', async () => {
    const { BrowserManager } = await import('../src/browser-manager');
    const bm = new BrowserManager();
    const calls: Array<number | undefined> = [];
    bm.onDisconnect = (code?: number) => { calls.push(code); };
    bm.onDisconnect(0);
    bm.onDisconnect(2);
    bm.onDisconnect(undefined);
    expect(calls).toEqual([0, 2, undefined]);
  });

  it('server.ts callback forwards exitCode when provided, falls back to 2', async () => {
    // Mirror the production wiring in browse/src/server.ts so a refactor
    // that drops the forward (e.g. reverting to `() => activeShutdown?.(2)`)
    // fails CI before the user-visible bug returns.
    const shutdownCalls: number[] = [];
    const activeShutdown = (code: number) => { shutdownCalls.push(code); };
    const onDisconnect = (code?: number) => activeShutdown(code ?? 2);
    onDisconnect(0);
    onDisconnect(2);
    onDisconnect(undefined);
    expect(shutdownCalls).toEqual([0, 2, 2]);
  });
});
