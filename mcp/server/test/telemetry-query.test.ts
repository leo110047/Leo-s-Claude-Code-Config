import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { runTelemetryQuery } from '../src/telemetry-query.js';

test('telemetry_query aggregates hook decisions by rule', () => {
  const usageFile = writeFixture([
    event('hook-decision', 'dev-server-blocker', 'deny'),
    event('hook-decision', 'dev-server-blocker', 'deny'),
    event('hook-decision', 'doc-file-blocker', 'deny'),
    event('workflow-entry', 'goldband-review', 'invoked'),
  ]);

  const result = runTelemetryQuery({
    usageFile,
    eventType: 'hook-decision',
    groupBy: 'rule',
  });

  assert.deepEqual(result.structuredContent.results, [
    { name: 'dev-server-blocker', count: 2 },
    { name: 'doc-file-blocker', count: 1 },
  ]);
});

test('telemetry_query aggregates workflow entries by skill', () => {
  const usageFile = writeFixture([
    event('workflow-entry', 'goldband-review', 'invoked'),
    event('workflow-entry', 'goldband-review', 'invoked'),
    event('prompt-trigger', 'testing-strategy', 'suggest'),
  ]);

  const result = runTelemetryQuery({
    usageFile,
    eventType: 'all',
    groupBy: 'skill',
  });

  assert.deepEqual(result.structuredContent.results, [
    { name: 'goldband-review', count: 2 },
    { name: 'testing-strategy', count: 1 },
  ]);
});

function event(category: string, name: string, action: string) {
  return {
    category,
    name,
    action,
    recordedAt: new Date().toISOString(),
  };
}

function writeFixture(events: object[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-mcp-usage-'));
  const usageFile = path.join(dir, 'usage-events.jsonl');
  fs.writeFileSync(
    usageFile,
    events.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
    'utf8',
  );
  return usageFile;
}
