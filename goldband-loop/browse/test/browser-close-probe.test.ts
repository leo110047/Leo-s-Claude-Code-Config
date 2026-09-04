import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { chromium } from 'playwright';

const PROBE = path.resolve(import.meta.dir, '../../scripts/browser-close-probe.ts');
const describeWithChromium = fs.existsSync(chromium.executablePath()) ? describe : describe.skip;

describeWithChromium('browser close probe', () => {
  test('confirms a normal browser close', async () => {
    const result = Bun.spawnSync([
      process.execPath,
      'run',
      PROBE,
      '--timeout-ms',
      '10000',
    ], { stdout: 'pipe', stderr: 'pipe', timeout: 15_000 });

    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(result.stdout.toString()).toContain('browser close confirmed');
  }, 20_000);

  test('times out a hung close probe and confirms its process group is gone', async () => {
    const result = Bun.spawnSync([
      process.execPath,
      'run',
      PROBE,
      '--simulate-hang',
      '--timeout-ms',
      '500',
    ], { stdout: 'pipe', stderr: 'pipe', timeout: 5_000 });

    expect(result.exitCode, result.stderr.toString()).toBe(124);
    expect(result.stdout.toString()).toContain('simulated close hang started');
    expect(result.stderr.toString()).toContain('wall-clock timeout exceeded');
  }, 10_000);
});
