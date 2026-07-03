#!/usr/bin/env node

const fs = require('fs');
const { getMetricsFile } = require('../lib/hook-router/metrics');
const { getUsageFile } = require('../lib/hook-router/usage-telemetry');

function parseArgs(argv) {
  const options = {
    json: argv.includes('--json'),
    days: 30,
    limit: 20,
  };

  for (let index = 2; index < argv.length; index += 1) {
    index = consumeArg(options, argv, index);
  }

  return options;
}

function consumeArg(options, argv, index) {
  const token = argv[index];
  if (token === '--json') return index;
  if (token === '--days')
    return consumePositiveInt(options, argv, index, 'days');
  if (token === '--limit') {
    return consumePositiveInt(options, argv, index, 'limit');
  }
  return index;
}

function consumePositiveInt(options, argv, index, key) {
  const next = parseInt(argv[index + 1], 10);
  if (Number.isFinite(next) && next > 0) {
    options[key] = next;
  }
  return index + 1;
}

function loadJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];

  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function scopedByDays(rows, days) {
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  return rows.filter((row) => {
    const recordedAt = Date.parse(row.recordedAt || '');
    return Number.isFinite(recordedAt) && recordedAt >= cutoffMs;
  });
}

function increment(map, key, fields) {
  const current = map.get(key) || { ...fields, count: 0 };
  current.count += 1;
  map.set(key, current);
}

function sortedCounts(map, limit) {
  return [...map.values()]
    .sort(
      (left, right) =>
        right.count - left.count ||
        String(left.name || '').localeCompare(String(right.name || '')),
    )
    .slice(0, limit);
}

function summarizeWorkflowEntries(events, confidence, limit) {
  const counts = new Map();
  for (const event of events) {
    if (
      event.category !== 'workflow-entry' ||
      event.confidence !== confidence
    ) {
      continue;
    }

    const host = event.host || 'unknown';
    const name = event.name || 'unknown';
    const action = event.action || 'unknown';
    increment(counts, `${host}|${name}|${action}`, {
      host,
      name,
      action,
      confidence,
    });
  }
  return sortedCounts(counts, limit);
}

function summarizeUsageCategory(events, category, action, limit) {
  const counts = new Map();
  for (const event of events) {
    if (event.category !== category || event.action !== action) continue;

    const name = event.name || 'unknown';
    const host = event.detail?.host || event.host || 'unknown';
    increment(counts, `${host}|${name}`, { host, name, action });
  }
  return sortedCounts(counts, limit);
}

function summarizeTopEvents(events, limit) {
  const counts = new Map();
  for (const event of events) {
    const category = event.category || 'unknown';
    const name = event.name || 'unknown';
    const action = event.action || 'unknown';
    increment(counts, `${category}|${name}|${action}`, {
      category,
      name,
      action,
    });
  }
  return sortedCounts(counts, limit);
}

function summarizeMetrics(metrics, limit) {
  const blocked = new Map();
  for (const metric of metrics) {
    if (metric.decision !== 'block') continue;

    const name = metric.blockedBy || metric.phase || 'unknown';
    increment(blocked, name, {
      name,
      action: 'deny',
      phase: metric.phase || 'unknown',
    });
  }

  return {
    totalEvents: metrics.length,
    hookDenies: sortedCounts(blocked, limit),
  };
}

function dataWindow(rows) {
  const timestamps = rows
    .map((row) => Date.parse(row.recordedAt || ''))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);

  if (timestamps.length === 0) {
    return { firstRecordedAt: null, lastRecordedAt: null };
  }

  return {
    firstRecordedAt: new Date(timestamps[0]).toISOString(),
    lastRecordedAt: new Date(timestamps[timestamps.length - 1]).toISOString(),
  };
}

function summarizeEvents(options, paths, rows) {
  const events = scopedByDays(rows.usageEvents, options.days);
  const metrics = scopedByDays(rows.metrics, options.days);
  const sessions = new Set(
    events.map((event) => event.sessionId).filter(Boolean),
  );

  return {
    generatedAt: new Date().toISOString(),
    days: options.days,
    paths,
    dataWindow: dataWindow([...events, ...metrics]),
    usage: {
      totalEvents: events.length,
      uniqueSessions: sessions.size,
      topEvents: summarizeTopEvents(events, options.limit),
    },
    workflowEntries: {
      confirmed: summarizeWorkflowEntries(events, 'confirmed', options.limit),
      inferred: summarizeWorkflowEntries(events, 'inferred', options.limit),
    },
    hooks: {
      denies: summarizeUsageCategory(
        events,
        'hook-decision',
        'deny',
        options.limit,
      ),
      advisories: summarizeUsageCategory(
        events,
        'hook-advisory',
        'emit',
        options.limit,
      ),
    },
    metrics: summarizeMetrics(metrics, options.limit),
  };
}

function printCountRows(rows, emptyMessage, formatRow) {
  if (rows.length === 0) {
    console.log(`- ${emptyMessage}`);
    return;
  }

  for (const row of rows) {
    console.log(`- ${formatRow(row)}`);
  }
}

function printHuman(summary) {
  console.log('Goldband Telemetry Summary');
  console.log('==========================');
  console.log(`Window: ${summary.days} day(s)`);
  console.log(`Usage log: ${summary.paths.usageFile}`);
  console.log(`Metrics log: ${summary.paths.metricsFile}`);
  console.log(
    `Data window: ${summary.dataWindow.firstRecordedAt || 'none'} -> ${summary.dataWindow.lastRecordedAt || 'none'}`,
  );
  console.log(
    `Usage events: ${summary.usage.totalEvents} | Sessions: ${summary.usage.uniqueSessions}`,
  );

  console.log('');
  console.log('Workflow Entry Signals - Confirmed:');
  printCountRows(
    summary.workflowEntries.confirmed,
    'No confirmed workflow entry invocations found.',
    (row) => `${row.host}/${row.name}/${row.action}: ${row.count}`,
  );

  console.log('');
  console.log('Workflow Entry Signals - Inferred:');
  printCountRows(
    summary.workflowEntries.inferred,
    'No inferred workflow entry signals found.',
    (row) => `${row.host}/${row.name}/${row.action}: ${row.count}`,
  );

  console.log('');
  console.log('Hook Denies:');
  printCountRows(
    summary.hooks.denies,
    'No hook deny events found.',
    (row) => `${row.host}/${row.name}: ${row.count}`,
  );

  console.log('');
  console.log('Hook Advisories:');
  printCountRows(
    summary.hooks.advisories,
    'No hook advisory events found.',
    (row) => `${row.host}/${row.name}: ${row.count}`,
  );
}

function main() {
  const options = parseArgs(process.argv);
  const paths = {
    usageFile: getUsageFile(),
    metricsFile: getMetricsFile(),
  };
  const rows = {
    usageEvents: loadJsonl(paths.usageFile),
    metrics: loadJsonl(paths.metricsFile),
  };
  const summary = summarizeEvents(options, paths, rows);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  printHuman(summary);
}

if (require.main === module) {
  main();
}

module.exports = {
  loadJsonl,
  summarizeEvents,
};
