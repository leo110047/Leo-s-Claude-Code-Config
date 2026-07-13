import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BROWSESAFE_BENCH_CASES } from './security-bench-contract';
import {
  loadOrFetchBenchRows,
  type BenchRow,
  type FetchLike,
} from './security-bench-cache';

let tempDir: string | null = null;

afterEach(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

function makeRows(count: number, offset = 0): BenchRow[] {
  return Array.from({ length: count }, (_, index) => ({
    content: `case-${offset + index}`,
    label: (offset + index) % 2 === 0 ? 'yes' : 'no',
  }));
}

function createDatasetFetch(calls: string[]): FetchLike {
  return async (input) => {
    const url = new URL(String(input));
    calls.push(url.toString());
    const offset = Number(url.searchParams.get('offset'));
    const length = Number(url.searchParams.get('length'));
    return new Response(JSON.stringify({
      rows: makeRows(length, offset).map(row => ({ row })),
    }));
  };
}

describe('BrowseSafe-Bench cache contract', () => {
  test('refreshes a stale 200-row cache to the current 500-row contract', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'security-bench-cache-'));
    const cacheFile = path.join(tempDir, 'test-rows.json');
    fs.writeFileSync(cacheFile, JSON.stringify(makeRows(200)));
    const calls: string[] = [];
    const messages: string[] = [];

    const rows = await loadOrFetchBenchRows({
      cacheFile,
      fetchImpl: createDatasetFetch(calls),
      log: message => messages.push(message),
    });

    expect(rows).toHaveLength(BROWSESAFE_BENCH_CASES);
    expect(JSON.parse(fs.readFileSync(cacheFile, 'utf8'))).toHaveLength(BROWSESAFE_BENCH_CASES);
    expect(calls).toHaveLength(5);
    expect(messages.join('\n')).toContain('cache has 200 cases; refreshing to 500');
  });

  test('reuses a cache that already satisfies the current contract', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'security-bench-cache-'));
    const cacheFile = path.join(tempDir, 'test-rows.json');
    fs.writeFileSync(cacheFile, JSON.stringify(makeRows(BROWSESAFE_BENCH_CASES)));

    const rows = await loadOrFetchBenchRows({
      cacheFile,
      fetchImpl: async () => {
        throw new Error('fetch should not run for a current cache');
      },
    });

    expect(rows).toHaveLength(BROWSESAFE_BENCH_CASES);
  });

  test('keeps the stale cache and reports the contract when refresh fails', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'security-bench-cache-'));
    const cacheFile = path.join(tempDir, 'test-rows.json');
    fs.writeFileSync(cacheFile, JSON.stringify(makeRows(200)));

    await expect(loadOrFetchBenchRows({
      cacheFile,
      fetchImpl: async () => new Response('offline', { status: 503 }),
      log: () => {},
    })).rejects.toThrow(
      'cache has 200 cases; refresh failed before the cache was replaced: HF API 503',
    );
    expect(JSON.parse(fs.readFileSync(cacheFile, 'utf8'))).toHaveLength(200);
  });
});
