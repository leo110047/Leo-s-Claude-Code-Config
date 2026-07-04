#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {
  normalizeUsageEvent,
  stableIdFrom,
  UNKNOWN_RUN_ID,
} = require('./lib/telemetry-schema.cjs');

const repoDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const { getUsageFile } = require(
  path.join(repoDir, 'hooks/scripts/lib/hook-router/usage-telemetry.js'),
);

const ARG_HANDLERS = {
  '--endpoint': (options, value) => {
    options.endpoint = value;
  },
  '--usage-file': (options, value) => {
    options.usageFile = value;
  },
  '--cursor-file': (options, value) => {
    options.cursorFile = value;
  },
  '--since': (options, value) => {
    options.since = value;
  },
  '--limit': (options, value) => {
    options.limit = parsePositiveInt(value, null);
  },
};

function parseArgs(argv) {
  const options = {
    endpoint: 'http://localhost:4318',
    usageFile: getUsageFile(),
    cursorFile: null,
    dryRun: false,
    help: false,
    since: null,
    limit: null,
  };

  consumeArgs(options, argv);

  if (!options.cursorFile) {
    options.cursorFile = `${options.usageFile}.otlp-cursor.json`;
  }
  return options;
}

function consumeArgs(options, argv) {
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (token === '--help' || token === '-h') {
      options.help = true;
      continue;
    }
    const handler = ARG_HANDLERS[token];
    if (handler) {
      handler(options, argv[++index]);
    }
  }
}

function usage() {
  return [
    'Usage: node scripts/export-telemetry-otlp.mjs [options]',
    '',
    'Options:',
    '  --endpoint <url>      OTLP/HTTP endpoint, default http://localhost:4318',
    '  --usage-file <path>   JSONL usage file',
    '  --cursor-file <path>  Cursor file for sent byte offset',
    '  --since <iso-date>    Filter events by timestamp; dry-run only',
    '  --dry-run             Print OTLP JSON without sending or advancing cursor',
    '  --limit <n>           Export at most n events',
    '  --help, -h            Show this help',
  ].join('\n');
}

function validateOptions(options) {
  if (options.since && !options.dryRun) {
    throw new Error(
      '--since is only supported with --dry-run to avoid cursor skips',
    );
  }
}

function parsePositiveInt(value, fallback) {
  const parsed = parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function loadCursor(cursorFile) {
  try {
    const payload = JSON.parse(fs.readFileSync(cursorFile, 'utf8'));
    return Number.isFinite(payload.offset) && payload.offset >= 0
      ? payload.offset
      : 0;
  } catch {
    return 0;
  }
}

function saveCursor(cursorFile, offset) {
  fs.mkdirSync(path.dirname(cursorFile), { recursive: true });
  fs.writeFileSync(
    cursorFile,
    `${JSON.stringify({ offset, exportedAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8',
  );
}

function readUsageEvents(filePath, options = {}) {
  if (!fs.existsSync(filePath)) return { events: [], nextOffset: 0 };

  const startOffset = Number.isFinite(options.offset) ? options.offset : 0;
  const buffer = fs.readFileSync(filePath);
  const safeOffset = Math.min(startOffset, buffer.length);
  return readUsageEventsFromBuffer(buffer, safeOffset, options);
}

function readUsageEventsFromBuffer(buffer, safeOffset, options) {
  const context = {
    sinceMs: options.since ? Date.parse(options.since) : null,
    limit: options.limit,
  };
  const events = [];
  let nextOffset = safeOffset;
  const text = buffer.subarray(safeOffset).toString('utf8');
  const lines = text.split('\n');
  const completeLines = lines.slice(0, -1);

  // Leave an incomplete trailing append unread; the next export will parse it
  // after the writer finishes the newline-terminated JSONL record.
  for (const line of completeLines) {
    nextOffset += Buffer.byteLength(line) + 1;
    addLineEvent(events, line, context);
    if (context.limit && events.length >= context.limit) break;
  }

  return { events, nextOffset: Math.min(nextOffset, buffer.length) };
}

function addLineEvent(events, line, context) {
  if (!line.trim()) return;

  const parsed = parseJsonLine(line);
  if (!parsed) return;

  const event = normalizeUsageEvent(parsed, { env: {}, stableEventId: true });
  if (!eventPassesSince(event, context.sinceMs)) return;
  events.push(event);
}

function eventPassesSince(event, sinceMs) {
  if (!Number.isFinite(sinceMs)) return true;

  const recordedAtMs = Date.parse(event.recordedAt || '');
  return Number.isFinite(recordedAtMs) && recordedAtMs >= sinceMs;
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function buildOtlpPayload(events) {
  const spans = events.map(eventToSpan);
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            stringAttr('service.name', 'goldband'),
            stringAttr('telemetry.sdk.name', 'goldband-jsonl-otlp-exporter'),
          ],
        },
        scopeSpans: [
          {
            scope: {
              name: 'goldband.telemetry.exporter',
              version: '1.0.0',
            },
            spans,
          },
        ],
      },
    ],
  };
}

function eventToSpan(event) {
  const runId = event.run_id || UNKNOWN_RUN_ID;
  const eventId = event.event_id || stableIdFrom(JSON.stringify(event), 'evt');
  const span = {
    traceId: traceIdFor(runId),
    spanId: spanIdFor(eventId),
    name: spanName(event),
    kind: 2,
    startTimeUnixNano: timeUnixNano(event.recordedAt),
    endTimeUnixNano: timeUnixNano(event.recordedAt),
    attributes: spanAttributes(event),
  };
  if (event.parent_event_id) {
    span.parentSpanId = spanIdFor(event.parent_event_id);
  }
  return span;
}

function spanName(event) {
  return `${event.category || 'unknown'}:${event.name || 'unknown'}`;
}

function timeUnixNano(value) {
  const parsed = Date.parse(value || '');
  const millis = Number.isFinite(parsed) ? parsed : Date.now();
  return String(BigInt(millis) * 1000000n);
}

function traceIdFor(runId) {
  return stableHex(runId || UNKNOWN_RUN_ID, 32);
}

function spanIdFor(eventId) {
  return stableHex(eventId, 16);
}

function stableHex(value, length) {
  return crypto
    .createHash('sha256')
    .update(String(value || ''))
    .digest('hex')
    .slice(0, length);
}

function spanAttributes(event) {
  const attributes = [
    stringAttr('goldband.schema_version', event.schema_version),
    stringAttr('goldband.run_id', event.run_id || UNKNOWN_RUN_ID),
    stringAttr('goldband.event_id', event.event_id),
    stringAttr('goldband.category', event.category),
    stringAttr('goldband.action', event.action),
    stringAttr('goldband.source', event.source),
    stringAttr('goldband.host', event.host || event.detail?.host || 'unknown'),
    stringAttr('gen_ai.operation.name', operationName(event)),
    stringAttr('gen_ai.provider.name', providerName(event)),
    stringAttr('gen_ai.conversation.id', event.run_id || UNKNOWN_RUN_ID),
  ];

  if (event.confidence) {
    attributes.push(stringAttr('goldband.confidence', event.confidence));
  }
  if (event.parent_event_id) {
    attributes.push(
      stringAttr('goldband.parent_event_id', event.parent_event_id),
    );
  }
  for (const [key, value] of Object.entries(event.detail || {})) {
    attributes.push(anyAttr(`goldband.detail.${key}`, value));
  }
  return attributes.filter(Boolean);
}

function operationName(event) {
  if (event.category === 'workflow-entry') return 'invoke_workflow';
  if (event.category === 'hook-decision') return 'execute_tool';
  if (event.category === 'hook-advisory') return 'execute_tool';
  return 'invoke_agent';
}

function providerName(event) {
  const host = event.host || event.detail?.host;
  if (host === 'claude') return 'anthropic';
  if (host === 'codex') return 'openai';
  return 'goldband';
}

function stringAttr(key, value) {
  if (value === null || value === undefined) return null;
  return { key, value: { stringValue: String(value) } };
}

function anyAttr(key, value) {
  if (value === null || value === undefined) return stringAttr(key, '');
  if (typeof value === 'boolean') return { key, value: { boolValue: value } };
  if (Number.isInteger(value)) {
    return { key, value: { intValue: String(value) } };
  }
  if (typeof value === 'number') return { key, value: { doubleValue: value } };
  if (typeof value === 'string') return stringAttr(key, value);
  return stringAttr(key, JSON.stringify(value));
}

function tracesUrl(endpoint) {
  const url = new URL(endpoint);
  if (!url.pathname.endsWith('/v1/traces')) {
    url.pathname = path.posix.join(url.pathname, '/v1/traces');
  }
  return url;
}

function postJson(url, payload) {
  const body = JSON.stringify(payload);
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(
      url,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (response) => {
        let responseBody = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          responseBody += chunk;
        });
        response.on('end', () => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve({ statusCode: response.statusCode, body: responseBody });
            return;
          }
          reject(
            new Error(
              `OTLP export failed with HTTP ${response.statusCode}: ${responseBody}`,
            ),
          );
        });
      },
    );
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    console.log(usage());
    return;
  }
  validateOptions(options);

  const offset = options.dryRun ? 0 : loadCursor(options.cursorFile);
  const { events, nextOffset } = readUsageEvents(options.usageFile, {
    offset,
    since: options.since,
    limit: options.limit,
  });
  const payload = buildOtlpPayload(events);

  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  if (events.length === 0) {
    console.log('No telemetry events to export.');
    return;
  }

  await postJson(tracesUrl(options.endpoint), payload);
  saveCursor(options.cursorFile, nextOffset);
  console.log(
    `Exported ${events.length} telemetry event(s) to ${tracesUrl(options.endpoint)}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error && error.message ? error.message : String(error));
    process.exit(1);
  });
}

export {
  buildOtlpPayload,
  loadCursor,
  parseArgs,
  readUsageEvents,
  saveCursor,
  spanIdFor,
  traceIdFor,
  tracesUrl,
  usage,
  validateOptions,
};
