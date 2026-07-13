import * as crypto from 'node:crypto';

export const BROWSESAFE_BENCH_CASES = 500;
export const BROWSESAFE_BENCH_DATASET_VERSION =
  `browsesafe-bench-smoke-${BROWSESAFE_BENCH_CASES}`;

interface CapturedCase<TSignal> {
  content: string;
  label: 'yes' | 'no';
  signals: TSignal[];
}

export function buildBenchmarkCaseArtifacts<TSignal>(cases: CapturedCase<TSignal>[]) {
  const replayCases = cases.map((row, id) => ({
    id,
    hash: crypto.createHash('sha256').update(row.content).digest('hex'),
    label: row.label,
    signals: row.signals,
  }));
  const rawCases = cases.map((row, id) => ({
    ...replayCases[id],
    content: row.content,
  }));
  return { replayCases, rawCases };
}
