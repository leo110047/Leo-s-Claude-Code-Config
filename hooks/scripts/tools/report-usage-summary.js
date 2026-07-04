#!/usr/bin/env node

const { getMetricsFile } = require('../lib/hook-router/metrics');
const { getUsageFile } = require('../lib/hook-router/usage-telemetry');
const {
  loadJsonl,
  summarizeEvents,
} = require('../lib/hook-router/usage-summary');

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

function buildSummary(options) {
  const paths = {
    usageFile: getUsageFile(),
    metricsFile: getMetricsFile(),
  };
  const rows = {
    usageEvents: loadJsonl(paths.usageFile),
    metrics: loadJsonl(paths.metricsFile),
  };
  return summarizeEvents(options, paths, rows);
}

function main() {
  const options = parseArgs(process.argv);
  const summary = buildSummary(options);

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
  buildSummary,
  parseArgs,
};
