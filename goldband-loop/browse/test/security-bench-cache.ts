import * as fs from 'node:fs';
import * as path from 'node:path';
import { BROWSESAFE_BENCH_CASES } from './security-bench-contract';

const HF_API = 'https://datasets-server.huggingface.co/rows?dataset=perplexity-ai/browsesafe-bench&config=default&split=test';

export type BenchRow = { content: string; label: 'yes' | 'no' };
export type FetchLike = (input: string) => Promise<Response>;

interface LoadBenchRowsOptions {
  cacheFile: string;
  fetchImpl?: FetchLike;
  log?: (message: string) => void;
}

function isBenchRow(value: unknown): value is BenchRow {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.content === 'string' && (row.label === 'yes' || row.label === 'no');
}

async function fetchDatasetSample(fetchImpl: FetchLike): Promise<BenchRow[]> {
  const rows: BenchRow[] = [];
  // HF datasets-server caps at 100 rows per request.
  for (let offset = 0; rows.length < BROWSESAFE_BENCH_CASES; offset += 100) {
    const length = Math.min(100, BROWSESAFE_BENCH_CASES - rows.length);
    const url = `${HF_API}&offset=${offset}&length=${length}`;
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error(`HF API ${response.status}: ${url}`);
    const data = (await response.json()) as { rows?: Array<{ row: unknown }> };
    if (!data.rows?.length) break;
    for (const entry of data.rows) {
      if (!isBenchRow(entry.row)) {
        throw new Error(`HF API returned an invalid row at offset ${offset}`);
      }
      rows.push(entry.row);
    }
  }
  return rows;
}

export async function loadOrFetchBenchRows({
  cacheFile,
  fetchImpl = fetch,
  log = console.log,
}: LoadBenchRowsOptions): Promise<BenchRow[]> {
  let staleDescription = 'cache is missing';

  if (fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as unknown;
      if (Array.isArray(cached) && cached.every(isBenchRow)) {
        if (cached.length >= BROWSESAFE_BENCH_CASES) return cached;
        staleDescription = `cache has ${cached.length} cases`;
      } else {
        staleDescription = 'cache has an invalid shape';
      }
    } catch (error) {
      staleDescription = `cache is unreadable: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  log(`[browsesafe-bench] ${staleDescription}; refreshing to ${BROWSESAFE_BENCH_CASES} cases`);

  let rows: BenchRow[];
  try {
    rows = await fetchDatasetSample(fetchImpl);
  } catch (error) {
    throw new Error(
      `BrowseSafe-Bench ${staleDescription}; refresh failed before the cache was replaced: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (rows.length < BROWSESAFE_BENCH_CASES) {
    throw new Error(
      `BrowseSafe-Bench refresh returned ${rows.length} cases; expected ${BROWSESAFE_BENCH_CASES}. The existing cache was not replaced.`,
    );
  }

  fs.mkdirSync(path.dirname(cacheFile), { recursive: true, mode: 0o700 });
  fs.writeFileSync(cacheFile, JSON.stringify(rows), { mode: 0o600 });
  return rows;
}
