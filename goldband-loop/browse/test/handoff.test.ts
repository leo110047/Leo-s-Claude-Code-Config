/**
 * Tests for handoff/resume commands — headless-to-headed browser switching.
 *
 * Unit tests cover saveState/restoreState, failure tracking, and edge cases.
 * Integration tests cover the full handoff flow with real Playwright browsers.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { startTestServer } from './test-server';
import { BrowserManager, type BrowserState } from '../src/browser-manager';
import { handleWriteCommand as _handleWriteCommand } from '../src/write-commands';
import { handleMetaCommand } from '../src/meta-commands';
import { pickFreeDisplay, spawnXvfb, type XvfbHandle } from '../src/xvfb';

const handleWriteCommand = (cmd: string, args: string[], b: BrowserManager) =>
  _handleWriteCommand(cmd, args, b.getActiveSession(), b);

let testServer: ReturnType<typeof startTestServer>;
let bm: BrowserManager;
let baseUrl: string;
let xvfb: XvfbHandle | null = null;
let originalDisplay: string | undefined;

beforeAll(async () => {
  originalDisplay = process.env.DISPLAY;
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    const display = pickFreeDisplay();
    if (display === null) throw new Error('No free X display is available for headed handoff tests.');
    xvfb = await spawnXvfb(display);
    process.env.DISPLAY = xvfb.display;
  }

  testServer = startTestServer(0);
  baseUrl = testServer.url;

  bm = new BrowserManager();
  await bm.launch();
});

afterAll(async () => {
  const cleanupErrors: unknown[] = [];
  try { await bm?.close(15_000); } catch (error) { cleanupErrors.push(error); }
  try { await testServer?.server.stop(true); } catch (error) { cleanupErrors.push(error); }
  try { await xvfb?.closeStrict(); } catch (error) { cleanupErrors.push(error); }
  if (originalDisplay === undefined) delete process.env.DISPLAY;
  else process.env.DISPLAY = originalDisplay;
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'handoff test cleanup failed');
  }
}, 20_000);

// ─── Unit Tests: Failure Tracking (no browser needed) ────────────

describe('failure tracking', () => {
  test('getFailureHint returns null when below threshold', () => {
    const tracker = new BrowserManager();
    tracker.incrementFailures();
    tracker.incrementFailures();
    expect(tracker.getFailureHint()).toBeNull();
  });

  test('getFailureHint returns hint after 3 consecutive failures', () => {
    const tracker = new BrowserManager();
    tracker.incrementFailures();
    tracker.incrementFailures();
    tracker.incrementFailures();
    const hint = tracker.getFailureHint();
    expect(hint).not.toBeNull();
    expect(hint).toContain('handoff');
    expect(hint).toContain('3');
  });

  test('hint suppressed when already headed', () => {
    const tracker = new BrowserManager();
    (tracker as any).isHeaded = true;
    tracker.incrementFailures();
    tracker.incrementFailures();
    tracker.incrementFailures();
    expect(tracker.getFailureHint()).toBeNull();
  });

  test('resetFailures clears the counter', () => {
    const tracker = new BrowserManager();
    tracker.incrementFailures();
    tracker.incrementFailures();
    tracker.incrementFailures();
    expect(tracker.getFailureHint()).not.toBeNull();
    tracker.resetFailures();
    expect(tracker.getFailureHint()).toBeNull();
  });

  test('getIsHeaded returns false by default', () => {
    const tracker = new BrowserManager();
    expect(tracker.getIsHeaded()).toBe(false);
  });
});

// ─── Unit Tests: State Save/Restore (shared browser) ─────────────

describe('saveState', () => {
  test('captures cookies and page URLs', async () => {
    await handleWriteCommand('goto', [baseUrl + '/basic.html'], bm);
    await handleWriteCommand('cookie', ['testcookie=testvalue'], bm);

    const state = await bm.saveState();

    expect(state.cookies.length).toBeGreaterThan(0);
    expect(state.cookies.some(c => c.name === 'testcookie')).toBe(true);
    expect(state.pages.length).toBeGreaterThanOrEqual(1);
    expect(state.pages.some(p => p.url.includes('/basic.html'))).toBe(true);
  }, 15000);

  test('captures localStorage and sessionStorage', async () => {
    await handleWriteCommand('goto', [baseUrl + '/basic.html'], bm);
    const page = bm.getPage();
    await page.evaluate(() => {
      localStorage.setItem('lsKey', 'lsValue');
      sessionStorage.setItem('ssKey', 'ssValue');
    });

    const state = await bm.saveState();
    const activePage = state.pages.find(p => p.isActive);

    expect(activePage).toBeDefined();
    expect(activePage!.storage).not.toBeNull();
    expect(activePage!.storage!.localStorage).toHaveProperty('lsKey', 'lsValue');
    expect(activePage!.storage!.sessionStorage).toHaveProperty('ssKey', 'ssValue');
  }, 15000);

  test('captures multiple tabs', async () => {
    while (bm.getTabCount() > 1) {
      await bm.closeTab();
    }
    await handleWriteCommand('goto', [baseUrl + '/basic.html'], bm);
    await handleMetaCommand('newtab', [baseUrl + '/form.html'], bm, () => {});

    const state = await bm.saveState();
    expect(state.pages.length).toBe(2);
    const activePage = state.pages.find(p => p.isActive);
    expect(activePage).toBeDefined();
    expect(activePage!.url).toContain('/form.html');

    await bm.closeTab();
  }, 15000);
});

describe('restoreState', () => {
  test('state survives recreateContext round-trip', async () => {
    await handleWriteCommand('goto', [baseUrl + '/basic.html'], bm);
    await handleWriteCommand('cookie', ['restored=yes'], bm);

    const stateBefore = await bm.saveState();
    expect(stateBefore.cookies.some(c => c.name === 'restored')).toBe(true);

    await bm.recreateContext();

    const stateAfter = await bm.saveState();
    expect(stateAfter.cookies.some(c => c.name === 'restored')).toBe(true);
    expect(stateAfter.pages.length).toBeGreaterThanOrEqual(1);
  }, 30000);
});

// ─── Unit Tests: Handoff Edge Cases ──────────────────────────────

describe('handoff edge cases', () => {
  test('handoff when already headed returns no-op', async () => {
    (bm as any).isHeaded = true;
    const result = await bm.handoff('test');
    expect(result).toContain('Already in headed mode');
    (bm as any).isHeaded = false;
  }, 10000);

  test('resume clears refs and resets failures', () => {
    bm.incrementFailures();
    bm.incrementFailures();
    bm.incrementFailures();
    bm.resume();
    expect(bm.getFailureHint()).toBeNull();
    expect(bm.getRefCount()).toBe(0);
  });

  test('resume without prior handoff works via meta command', async () => {
    await handleWriteCommand('goto', [baseUrl + '/basic.html'], bm);
    const result = await handleMetaCommand('resume', [], bm, () => {});
    expect(result).toContain('RESUMED');
  }, 15000);
});

// ─── Integration Tests: Full Handoff Flow ────────────────────────
// Each handoff test creates its own BrowserManager since handoff swaps the browser.
// These tests run sequentially (one browser at a time) to avoid resource issues.

describe('handoff integration', () => {
  test('failed headed restore returns control to the original headless browser', async () => {
    const hbm = new BrowserManager();
    await hbm.launch();
    const restoreState = hbm.restoreState.bind(hbm);

    try {
      await handleWriteCommand('goto', [baseUrl + '/basic.html'], hbm);
      const ownedTabId = await hbm.newTab(baseUrl + '/form.html', 'owner-a');
      const originalBrowser = (hbm as any).browser;
      const originalTabIds = [...(hbm as any).pages.keys()];
      const originalNextTabId = (hbm as any).nextTabId;
      let replacementBrowser: any;
      (hbm as any).restoreState = async (state: BrowserState) => {
        replacementBrowser = (hbm as any).browser;
        await restoreState(state);
        throw new Error('forced failure after replacement state mutation');
      };

      const result = await hbm.handoff('force restore failure');

      expect(result).toContain('ERROR: Handoff failed during state restore');
      expect(result).toContain('forced failure after replacement state mutation');
      expect(result).toContain('Original headless browser restored and still running.');
      expect(hbm.getConnectionMode()).toBe('launched');
      expect((hbm as any).browser).toBe(originalBrowser);
      expect(originalBrowser.isConnected()).toBe(true);
      expect(replacementBrowser.isConnected()).toBe(false);
      expect([...(hbm as any).pages.keys()]).toEqual(originalTabIds);
      expect(hbm.getActiveTabId()).toBe(ownedTabId);
      expect(hbm.getTabOwner(ownedTabId)).toBe('owner-a');
      expect((hbm as any).nextTabId).toBe(originalNextTabId);

      const { handleReadCommand } = await import('../src/read-commands');
      const text = await handleReadCommand('text', [], hbm);
      expect(text.length).toBeGreaterThan(0);
    } finally {
      (hbm as any).restoreState = restoreState;
      await hbm.close();
    }
  }, 45000);

  test('full handoff: cookies preserved, headed mode active, commands work', async () => {
    const hbm = new BrowserManager();
    await hbm.launch();

    try {
      // Set up state
      await handleWriteCommand('goto', [baseUrl + '/basic.html'], hbm);
      await handleWriteCommand('cookie', ['handoff_test=preserved'], hbm);

      // Handoff
      const result = await hbm.handoff('Testing handoff');
      expect(result).toContain('HANDOFF:');
      expect(result).toContain('Testing handoff');
      expect(result).toContain('resume');
      expect(hbm.getIsHeaded()).toBe(true);

      // Verify cookies survived
      const { handleReadCommand } = await import('../src/read-commands');
      const cookiesResult = await handleReadCommand('cookies', [], hbm);
      expect(cookiesResult).toContain('handoff_test');

      // Verify commands still work
      const text = await handleReadCommand('text', [], hbm);
      expect(text.length).toBeGreaterThan(0);

      // Resume
      const resumeResult = await handleMetaCommand('resume', [], hbm, () => {});
      expect(resumeResult).toContain('RESUMED');
    } finally {
      await hbm.close();
    }
  }, 45000);

  test('multi-tab handoff preserves all tabs', async () => {
    const hbm = new BrowserManager();
    await hbm.launch();

    try {
      await handleWriteCommand('goto', [baseUrl + '/basic.html'], hbm);
      await handleMetaCommand('newtab', [baseUrl + '/form.html'], hbm, () => {});
      expect(hbm.getTabCount()).toBe(2);

      await hbm.handoff('multi-tab test');
      expect(hbm.getTabCount()).toBe(2);
      expect(hbm.getIsHeaded()).toBe(true);
    } finally {
      await hbm.close();
    }
  }, 45000);

  test('handoff meta command joins args as message', async () => {
    const hbm = new BrowserManager();
    await hbm.launch();

    try {
      await handleWriteCommand('goto', [baseUrl + '/basic.html'], hbm);
      const result = await handleMetaCommand('handoff', ['CAPTCHA', 'stuck'], hbm, () => {});
      expect(result).toContain('CAPTCHA stuck');
    } finally {
      await hbm.close();
    }
  }, 45000);
});
