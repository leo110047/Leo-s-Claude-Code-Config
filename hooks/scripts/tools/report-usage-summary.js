#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { getUsageFile } = require('../lib/hook-router/usage-telemetry');

function parseArgs(argv) {
  const options = {
    json: argv.includes('--json'),
    days: 30,
    limit: 20
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--json') {
      continue;
    }

    if (token === '--days') {
      const next = parseInt(argv[index + 1], 10);
      if (Number.isFinite(next) && next > 0) {
        options.days = next;
      }
      index += 1;
      continue;
    }

    if (token === '--limit') {
      const next = parseInt(argv[index + 1], 10);
      if (Number.isFinite(next) && next > 0) {
        options.limit = next;
      }
      index += 1;
    }
  }

  return options;
}

function loadEvents(usageFile) {
  if (!fs.existsSync(usageFile)) {
    return [];
  }

  return fs.readFileSync(usageFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function summarizeEvents(events, options, usageFile) {
  const cutoffMs = Date.now() - (options.days * 24 * 60 * 60 * 1000);
  const scoped = events.filter(event => {
    const recordedAt = Date.parse(event.recordedAt || '');
    return Number.isFinite(recordedAt) && recordedAt >= cutoffMs;
  });

  const counts = new Map();
  const sessions = new Set();

  for (const event of scoped) {
    if (event.sessionId) {
      sessions.add(event.sessionId);
    }

    const key = `${event.category || 'unknown'}|${event.name || 'unknown'}|${event.action || 'unknown'}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const topEvents = [...counts.entries()]
    .map(([key, count]) => {
      const [category, name, action] = key.split('|');
      return { category, name, action, count };
    })
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, options.limit);

  return {
    usageFile,
    days: options.days,
    totalEvents: scoped.length,
    uniqueSessions: sessions.size,
    topEvents
  };
}

function printHuman(summary) {
  console.log('Goldband Usage Summary');
  console.log('======================');
  console.log(`File:           ${summary.usageFile}`);
  console.log(`Window:         last ${summary.days} day(s)`);
  console.log(`Events:         ${summary.totalEvents}`);
  console.log(`Unique sessions:${summary.uniqueSessions}`);

  if (summary.topEvents.length === 0) {
    console.log('');
    console.log('No usage events found in the selected window.');
    return;
  }

  console.log('');
  console.log('Top Events:');
  for (const event of summary.topEvents) {
    console.log(`- ${event.category}/${event.name}/${event.action}: ${event.count}`);
  }
}

function main() {
  const options = parseArgs(process.argv);
  const usageFile = getUsageFile();
  const events = loadEvents(usageFile);
  const summary = summarizeEvents(events, options, usageFile);

  if (options.json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    return;
  }

  printHuman(summary);
}

main();
