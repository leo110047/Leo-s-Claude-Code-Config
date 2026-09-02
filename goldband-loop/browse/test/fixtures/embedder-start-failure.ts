import * as fs from 'fs';

const stateFile = process.env.BROWSE_STATE_FILE;
if (!stateFile) throw new Error('BROWSE_STATE_FILE is required');

const { BrowserManager } = await import('../../src/browser-manager');
let browserResourceAcquired = false;
let browserResourceClosed = false;
const originalLaunch = BrowserManager.prototype.launch;
const originalStrictClose = BrowserManager.prototype.closeForStartupRollback;
BrowserManager.prototype.launch = async function () {
  browserResourceAcquired = true;
  if (process.env.BROWSE_FIXTURE_NO_PROCESS_HANDLE === '1') {
    let connected = true;
    (this as any).browser = {
      close: async () => { connected = false; },
      isConnected: () => connected,
      removeAllListeners: () => {},
    };
  }
};
BrowserManager.prototype.closeForStartupRollback = async function () {
  if (process.env.BROWSE_FIXTURE_NO_PROCESS_HANDLE === '1') {
    return originalStrictClose.call(this, 50);
  }
  if (process.env.BROWSE_FIXTURE_STRICT_CLOSE_FAILURE === '1') {
    throw new Error('fixture Chromium close remained unconfirmed');
  }
  browserResourceClosed = true;
};
delete process.env.BROWSE_HEADLESS_SKIP;

const { start } = await import('../../src/server');
const originalServe = Bun.serve;
(Bun as any).serve = () => {
  if (process.env.BROWSE_FIXTURE_BLOCK_RESERVATION_DELETE === '1') {
    fs.writeFileSync(`${stateFile}.owner-lock.reclaim`, 'fixture cleanup blocker');
  }
  throw new Error('fixture listener bind failure');
};

try {
  await start();
  console.error('start unexpectedly succeeded');
  process.exit(2);
} catch (error) {
  const blocksDelete = process.env.BROWSE_FIXTURE_BLOCK_RESERVATION_DELETE === '1';
  const strictCloseFails = process.env.BROWSE_FIXTURE_STRICT_CLOSE_FAILURE === '1';
  const missingProcessHandle = process.env.BROWSE_FIXTURE_NO_PROCESS_HANDLE === '1';
  if (!browserResourceAcquired || (!strictCloseFails && !missingProcessHandle && !browserResourceClosed)) {
    console.error('simulated browser resource was not fully rolled back');
    process.exit(4);
  }
  if (!blocksDelete && !strictCloseFails && !missingProcessHandle && fs.existsSync(stateFile)) {
    console.error('startup reservation survived the rejected start');
    process.exit(3);
  }
  if (blocksDelete && !fs.existsSync(stateFile)) {
    console.error('reservation was deleted despite blocked compare-delete');
    process.exit(5);
  }
  if ((strictCloseFails || missingProcessHandle) && !fs.existsSync(stateFile)) {
    console.error('reservation was deleted despite unconfirmed Chromium cleanup');
    process.exit(6);
  }
  const outcome = blocksDelete || strictCloseFails || missingProcessHandle ? 'fail-closed reservation' : 'cleanup';
  console.log(`embedder observed ${outcome}: ${(error as Error).message}`);
} finally {
  (Bun as any).serve = originalServe;
  BrowserManager.prototype.launch = originalLaunch;
  BrowserManager.prototype.closeForStartupRollback = originalStrictClose;
}

// start() builds unref'd lifecycle timers before binding the listener. Exit
// explicitly so this fixture reports the caught error instead of waiting for
// unrelated daemon timers to expire.
process.exit(0);
