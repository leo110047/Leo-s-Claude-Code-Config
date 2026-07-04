import { createRequire } from 'node:module';
import { fromRepo } from './repo.js';
import { jsonToolResult } from './types.js';

const require = createRequire(import.meta.url);
const { getUsageFile } = require(
  fromRepo('hooks/scripts/lib/hook-router/usage-telemetry.js'),
);
const { loadJsonl, queryUsageTelemetry } = require(
  fromRepo('hooks/scripts/lib/hook-router/usage-summary.js'),
);

export type TelemetryQueryInput = {
  days?: number;
  eventType?: 'all' | 'hook-decision' | 'workflow-entry' | 'prompt-trigger';
  groupBy?: 'rule' | 'skill';
  limit?: number;
  usageFile?: string;
};

export function runTelemetryQuery(input: TelemetryQueryInput) {
  const usageFile = input.usageFile ?? getUsageFile();
  const payload = queryUsageTelemetry(loadJsonl(usageFile), {
    days: input.days ?? 30,
    eventType: input.eventType ?? 'all',
    groupBy: input.groupBy ?? 'rule',
    limit: input.limit ?? 20,
  });
  return jsonToolResult({ ...payload, usageFile });
}
