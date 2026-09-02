import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

// v1.44 outer supervisor — static-grep invariants.
//
// Pre-v1.44 `$B connect` was fire-and-forget: spawn server detached, CLI
// exits, server runs unsupervised. If the server crashed, the user had to
// re-run `$B connect`. The opt-in supervisor (--supervise or
// BROWSE_SUPERVISE=1) keeps the CLI attached and respawns the server on
// unexpected exit, with the same crash-loop guard shape as the v1.44
// terminal-agent watchdog.
//
// Live respawn tests belong in the e2e tier (real Bun.spawn cycles take
// 3-8s each). These tripwires defend the load-bearing invariants:
// opt-in by default, signal handlers wired, crash-loop guard, env knobs.

const CLI_TS = path.resolve(new URL(import.meta.url).pathname, '..', '..', 'src', 'cli.ts');

describe('CLI outer supervisor (v1.44+)', () => {
  test('1. supervisor is opt-in via --supervise flag or BROWSE_SUPERVISE env', () => {
    const src = fs.readFileSync(CLI_TS, 'utf-8');
    expect(src).toContain("commandArgs.includes('--supervise')");
    expect(src).toContain("process.env.BROWSE_SUPERVISE === '1'");
    // Default path MUST still exit 0 promptly. The legacy contract is
    // that every caller of `$B connect` (Claude Code Bash tool, scripts,
    // CI) gets a prompt return.
    expect(src).toMatch(/if \(!superviseRequested\) \{\s*process\.exit\(0\);\s*\}/);
  });

  test('2. SIGINT and SIGTERM trigger clean teardown', () => {
    const src = fs.readFileSync(CLI_TS, 'utf-8');
    const block = sliceBetween(src, 'Supervisor mode:', '// ─── Headed Disconnect');
    // Both signals must hit the teardown path or the user's Ctrl-C leaves
    // an orphaned server (worse than no supervisor).
    expect(src).toMatch(/process\.on\('SIGINT'.*teardownAndExit/);
    expect(src).toMatch(/process\.on\('SIGTERM'.*teardownAndExit/);
    // Teardown must validate the recorded owner before routing through the
    // identity-aware termination helper.
    expect(block).toContain('sameControllerOwner(state, supervisedOwner)');
    expect(block).toContain('await killServer(state)');
  });

  test('3. crash-loop guard with 5-in-5min rolling window', () => {
    const src = fs.readFileSync(CLI_TS, 'utf-8');
    expect(src).toContain('SUPERVISOR_GUARD_WINDOW_MS = 5 * 60_000');
    expect(src).toContain('SUPERVISOR_GUARD_MAX = 5');
    // Window pruning: a long-lived daemon with sporadic crashes must NOT
    // hit the guard (otherwise we punish the user for the supervisor doing
    // its job).
    expect(src).toMatch(/respawns\.shift\(\)/);
  });

  test('4. exponential backoff schedule, env-overridable', () => {
    const src = fs.readFileSync(CLI_TS, 'utf-8');
    expect(src).toContain('GOLDBAND_SUPERVISOR_BACKOFF');
    // Default schedule must include short waits at first (rapid recovery
    // from transient crashes) and cap at a sensible long wait.
    expect(src).toContain('1000,2000,4000,8000,30000');
  });

  test('5. tick interval is env-overridable for tests', () => {
    const src = fs.readFileSync(CLI_TS, 'utf-8');
    expect(src).toContain('GOLDBAND_SUPERVISOR_TICK_MS');
  });

  test('6. respawned server gets a fresh terminal-agent too', () => {
    const src = fs.readFileSync(CLI_TS, 'utf-8');
    // After server respawn, the terminal-agent state is stale (old PID
    // record points to a dead agent that exited with its parent). The
    // supervisor must re-call spawnTerminalAgent or the PTY path stays
    // broken even though the server is back up.
    const block = sliceBetween(src, 'Supervisor mode:', '// ─── Headed Disconnect');
    expect(block).toContain('spawnTerminalAgent({');
  });

  test('7. unknown ownership fails closed and respawn shares the startup lock', () => {
    const src = fs.readFileSync(CLI_TS, 'utf-8');
    const block = sliceBetween(src, 'Supervisor mode:', '// ─── Headed Disconnect');
    expect(block).toContain("decideControllerTransition(inspection) === 'refuse'");
    expect(block).toContain('state preserved, no respawn');
    expect(block).toContain('const respawnLock = acquireServerLock()');
    expect(block).toContain('startServer(serverEnv, respawnLock)');
    expect(block).toContain('await prepareReplaceableController(latest)');
    expect(block.indexOf('await prepareReplaceableController(latest)')).toBeLessThan(
      block.indexOf('const respawned = await startServer(serverEnv, respawnLock)'),
    );
    expect(block).toContain('respawnLock.release()');
  });

  test('8. startup readiness requires the reserved instance and typed healthy response', () => {
    const src = fs.readFileSync(CLI_TS, 'utf-8');
    const block = sliceBetween(src, '// Wait for server to become healthy.', '/**\n * Acquire an exclusive lockfile');
    expect(block).toContain('state?.instanceId === instanceId');
    expect(block).toContain("state.phase === 'ready'");
    expect(block).toContain("await probeControllerHealth(state) === 'healthy'");
  });

  test('9. disconnect rechecks the owner under lock before destructive cleanup', () => {
    const src = fs.readFileSync(CLI_TS, 'utf-8');
    const block = sliceBetween(src, 'async function handleDisconnect()', '// ─── Main');
    expect(block.indexOf('const release = acquireServerLock()')).toBeLessThan(
      block.indexOf('const current = readLockedDisconnectOwner(existing)'),
    );
    expect(src).toContain('sameControllerOwner(current, controllerOwner(expected))');
    expect(block.indexOf('readLockedDisconnectOwner(existing)')).toBeLessThan(
      block.indexOf('cleanSharedChromiumProfileLocks()'),
    );
  });
});

function sliceBetween(source: string, start: string, end: string): string {
  const i = source.indexOf(start);
  if (i === -1) throw new Error(`marker not found: ${start}`);
  const j = source.indexOf(end, i + start.length);
  if (j === -1) throw new Error(`end marker not found: ${end}`);
  return source.slice(i, j);
}
