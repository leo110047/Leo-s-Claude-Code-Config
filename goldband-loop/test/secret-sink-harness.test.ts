/**
 * Tests for the secret-sink test harness (D21 #5).
 *
 * Positive controls: deliberately leak a seed in every covered channel and
 * assert the harness catches it. A harness that silently under-reports is
 * worse than no harness — these tests are the quality gate.
 */

import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runWithSecretSink } from './helpers/secret-sink-harness';

const LEAK_BIN_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'leak-bins-'));

// Build a disposable bash script that leaks in a specific way. Returns
// path to the executable. We don't bother cleaning these up per-test —
// they live under a tmpdir that's fine to linger between tests.
function makeLeakyBin(name: string, body: string): string {
  const p = path.join(LEAK_BIN_DIR, name);
  fs.writeFileSync(p, `#!/bin/bash\nset -euo pipefail\n${body}\n`, { mode: 0o755 });
  return p;
}

describe('secret-sink-harness — positive controls', () => {
  test('catches a seed echoed to stdout', async () => {
    const bin = makeLeakyBin(
      'leak-stdout',
      'echo "config contains: $LEAK_SEED"'
    );
    const seed = 'my-secret-password-12345';
    const r = await runWithSecretSink({
      bin,
      args: [],
      seeds: [seed],
      env: { LEAK_SEED: seed },
    });
    expect(r.leaks.length).toBeGreaterThan(0);
    const stdoutLeaks = r.leaks.filter((l) => l.channel === 'stdout');
    expect(stdoutLeaks.length).toBeGreaterThan(0);
    expect(stdoutLeaks.some((l) => l.matchType === 'exact')).toBe(true);
  });

  test('catches a seed echoed to stderr', async () => {
    const bin = makeLeakyBin(
      'leak-stderr',
      'echo "leaked: $LEAK_SEED" >&2'
    );
    const seed = 'another-secret-value-67890';
    const r = await runWithSecretSink({
      bin,
      args: [],
      seeds: [seed],
      env: { LEAK_SEED: seed },
    });
    expect(r.leaks.some((l) => l.channel === 'stderr')).toBe(true);
  });

  test('catches a seed written to a file under $HOME', async () => {
    const bin = makeLeakyBin(
      'leak-file',
      'mkdir -p "$HOME/.goldband" && echo "seed: $LEAK_SEED" > "$HOME/.goldband/debug.log"'
    );
    const seed = 'file-leaked-secret-value-xyz';
    const r = await runWithSecretSink({
      bin,
      args: [],
      seeds: [seed],
      env: { LEAK_SEED: seed },
    });
    const fileLeaks = r.leaks.filter((l) => l.channel === 'file');
    expect(fileLeaks.length).toBeGreaterThan(0);
    expect(fileLeaks[0].where).toBe('.goldband/debug.log');
  });

  test('catches a seed leaked into the telemetry channel', async () => {
    const bin = makeLeakyBin(
      'leak-telemetry',
      'mkdir -p "$HOME/.goldband/analytics" && ' +
      'echo "{\\"event\\":\\"x\\",\\"leaked_secret\\":\\"$LEAK_SEED\\"}" ' +
      '  >> "$HOME/.goldband/analytics/skill-usage.jsonl"'
    );
    const seed = 'telemetry-leaked-abc123xyz';
    const r = await runWithSecretSink({
      bin,
      args: [],
      seeds: [seed],
      env: { LEAK_SEED: seed },
    });
    const telemetryLeaks = r.leaks.filter((l) => l.channel === 'telemetry');
    expect(telemetryLeaks.length).toBeGreaterThan(0);
    expect(telemetryLeaks[0].where).toContain('analytics/');
  });

  test('catches a seed leaked in base64-encoded form (auth header pattern)', async () => {
    // printf (not echo) so no trailing newline — matches how real auth
    // headers encode: base64(seed) exactly, not base64(seed + "\n").
    const bin = makeLeakyBin(
      'leak-base64',
      'printf "%s" "$LEAK_SEED" | base64'
    );
    const seed = 'base64-leaked-long-enough-secret';
    const r = await runWithSecretSink({
      bin,
      args: [],
      seeds: [seed],
      env: { LEAK_SEED: seed },
    });
    expect(r.leaks.some((l) => l.matchType === 'base64')).toBe(true);
  });

  test('catches a first-12-char prefix leak (the "I only logged a portion" pattern)', async () => {
    const bin = makeLeakyBin(
      'leak-prefix',
      'prefix="${LEAK_SEED:0:12}"; echo "debug prefix: $prefix"'
    );
    const seed = 'prefix-leaked-0123456789abcdef';
    const r = await runWithSecretSink({
      bin,
      args: [],
      seeds: [seed],
      env: { LEAK_SEED: seed },
    });
    expect(r.leaks.some((l) => l.matchType === 'prefix-12')).toBe(true);
  });

  test('clean run with no leak returns an empty leaks array', async () => {
    const bin = makeLeakyBin('clean', 'echo "no secret here"');
    const r = await runWithSecretSink({
      bin,
      args: [],
      seeds: ['never-emitted-seed-xyz-987'],
    });
    expect(r.leaks).toEqual([]);
  });
});
