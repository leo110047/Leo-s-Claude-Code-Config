#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildOtlpPayload,
  loadCursor,
  readUsageEvents,
  saveCursor,
  spanIdFor,
  traceIdFor,
  tracesUrl,
  usage,
  validateOptions,
} from './export-telemetry-otlp.mjs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-otlp-test-'));
const usageFile = path.join(tmpDir, 'usage-events.jsonl');
const cursorFile = path.join(tmpDir, 'cursor.json');

process.on('exit', () => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const oldEvent = {
  category: 'workflow-entry',
  name: 'goldband-review',
  action: 'invoked',
  source: 'fixture',
  sessionId: 'legacy-session',
  confidence: 'confirmed',
  host: 'claude',
  detail: { host: 'claude', trigger: 'skill-tool' },
  recordedAt: '2026-07-01T00:00:00.000Z',
};
const newEvent = {
  schema_version: 'goldband.telemetry.v1',
  run_id: 'codex-run',
  event_id: 'event-child',
  parent_event_id: 'event-parent',
  category: 'hook-decision',
  name: 'recursive-force-delete',
  action: 'deny',
  source: 'fixture',
  sessionId: 'codex-run',
  host: 'codex',
  detail: { host: 'codex', hookEventName: 'PreToolUse', toolName: 'Bash' },
  recordedAt: '2026-07-02T00:00:00.000Z',
};
const unknownRunEvent = {
  category: 'hook-advisory',
  name: 'SessionStart',
  action: 'emit',
  source: 'fixture',
  host: 'claude',
  detail: { host: 'claude' },
  recordedAt: '2026-07-03T00:00:00.000Z',
};

fs.writeFileSync(
  usageFile,
  `${JSON.stringify(oldEvent)}\n${JSON.stringify(newEvent)}\n${JSON.stringify(unknownRunEvent)}\n`,
  'utf8',
);

const { events, nextOffset } = readUsageEvents(usageFile);
const repeatedRead = readUsageEvents(usageFile);
assert.equal(events.length, 3);
assert.equal(events[0].run_id, 'legacy-session');
assert.equal(events[0].schema_version, 'goldband.telemetry.v1');
assert.equal(events[0].event_id, repeatedRead.events[0].event_id);
assert.equal(events[1].run_id, 'codex-run');
assert.equal(events[2].run_id, 'unknown');
assert.equal(nextOffset, fs.statSync(usageFile).size);

const filtered = readUsageEvents(usageFile, {
  since: '2026-07-02T12:00:00.000Z',
});
assert.equal(filtered.events.length, 1);
assert.equal(filtered.events[0].name, 'SessionStart');

const payload = buildOtlpPayload(events);
const repeatedPayload = buildOtlpPayload(repeatedRead.events);
const spans = payload.resourceSpans[0].scopeSpans[0].spans;
assert.equal(spans.length, 3);
assert.equal(spans[0].traceId.length, 32);
assert.equal(spans[0].spanId.length, 16);
assert.equal(spans[0].traceId, traceIdFor('legacy-session'));
assert.equal(
  spans[0].spanId,
  repeatedPayload.resourceSpans[0].scopeSpans[0].spans[0].spanId,
);
assert.equal(spans[1].traceId, traceIdFor('codex-run'));
assert.equal(spans[1].parentSpanId, spanIdFor('event-parent'));
assert.ok(
  spans[1].attributes.some(
    (attribute) =>
      attribute.key === 'gen_ai.operation.name' &&
      attribute.value.stringValue === 'execute_tool',
  ),
);
assert.ok(
  spans[1].attributes.some(
    (attribute) =>
      attribute.key === 'gen_ai.provider.name' &&
      attribute.value.stringValue === 'openai',
  ),
);

saveCursor(cursorFile, nextOffset);
assert.equal(loadCursor(cursorFile), nextOffset);
assert.equal(
  readUsageEvents(usageFile, { offset: loadCursor(cursorFile) }).events.length,
  0,
);

assert.equal(
  String(tracesUrl('http://localhost:4318')),
  'http://localhost:4318/v1/traces',
);
assert.equal(
  String(tracesUrl('http://localhost:4318/v1/traces')),
  'http://localhost:4318/v1/traces',
);
assert.ok(usage().includes('--dry-run'));
assert.ok(usage().includes('dry-run only'));
assert.throws(
  () => validateOptions({ since: '2026-07-02T00:00:00.000Z', dryRun: false }),
  /--since is only supported with --dry-run/,
);
validateOptions({ since: '2026-07-02T00:00:00.000Z', dryRun: true });

const partialFile = path.join(tmpDir, 'partial-usage-events.jsonl');
const completeLine = `${JSON.stringify(newEvent)}\n`;
fs.writeFileSync(partialFile, `${completeLine}{"category":`, 'utf8');
const partialRead = readUsageEvents(partialFile);
assert.equal(partialRead.events.length, 1);
assert.equal(partialRead.nextOffset, Buffer.byteLength(completeLine));

console.log('[OK] telemetry OTLP exporter behavior verified');
