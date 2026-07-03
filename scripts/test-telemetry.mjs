#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-telemetry-'));
const usageFile = path.join(tmpDir, 'usage-events.jsonl');
const metricsFile = path.join(tmpDir, 'metrics.jsonl');
const claudeRouter = path.join(
  repoDir,
  'hooks',
  'scripts',
  'hooks',
  'hook-router.js',
);
const claudePromptHook = path.join(
  repoDir,
  'hooks',
  'scripts',
  'hooks',
  'skill-activation-suggestions.js',
);
const codexRouter = path.join(repoDir, 'codex', 'hooks', 'hook-router.js');

process.on('exit', () => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function runNode(script, input, extraEnv = {}, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [script], {
    cwd: repoDir,
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: {
      ...process.env,
      GOLDBAND_USAGE_FILE: usageFile,
      HOOK_ROUTER_METRICS_FILE: metricsFile,
      CLAUDE_SESSION_ID: 'claude-session',
      CODEX_SESSION_ID: 'codex-session',
      ...extraEnv,
    },
  });

  assert.equal(result.status, expectedStatus, result.stderr);
  return result;
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function runReportJson() {
  const result = spawnSync(
    process.execPath,
    ['hooks/scripts/tools/report-usage-summary.js', '--days', '30', '--json'],
    {
      cwd: repoDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        GOLDBAND_USAGE_FILE: usageFile,
        HOOK_ROUTER_METRICS_FILE: metricsFile,
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function hasEvent(events, expected) {
  return events.some((event) =>
    Object.entries(expected).every(([key, value]) => event[key] === value),
  );
}

function withEnv(updates, callback) {
  const previous = {};
  for (const key of Object.keys(updates)) {
    previous[key] = process.env[key];
    if (updates[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = updates[key];
    }
  }

  try {
    return callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function testPersistentPathAndMetricsDefault() {
  const { getPersistentDataPath } = require('../hooks/scripts/lib/utils.js');
  const {
    metricsEnabled,
  } = require('../hooks/scripts/lib/hook-router/metrics.js');

  process.env.GOLDBAND_DATA_DIR = path.join(tmpDir, 'data-root');
  const persistentPath = getPersistentDataPath(
    'hook-router',
    'usage-events.jsonl',
  );
  assert.equal(
    persistentPath,
    path.join(tmpDir, 'data-root', 'hook-router', 'usage-events.jsonl'),
  );

  delete process.env.HOOK_ROUTER_METRICS_ENABLED;
  assert.equal(metricsEnabled(), true);
  process.env.HOOK_ROUTER_METRICS_ENABLED = '0';
  assert.equal(metricsEnabled(), false);
  delete process.env.HOOK_ROUTER_METRICS_ENABLED;
  delete process.env.GOLDBAND_DATA_DIR;
}

function testCodexPluginDataRoot() {
  const codexTelemetry = require('../codex/hooks/telemetry.js');
  const pluginRoot = path.join(tmpDir, 'plugin-data');

  withEnv(
    {
      CLAUDE_PLUGIN_DATA: pluginRoot,
      GOLDBAND_DATA_DIR: undefined,
      GOLDBAND_USAGE_FILE: undefined,
      XDG_DATA_HOME: undefined,
    },
    () => {
      assert.equal(codexTelemetry.dataRoot(), pluginRoot);
      assert.equal(
        codexTelemetry.usageFile(),
        path.join(pluginRoot, 'hook-router', 'usage-events.jsonl'),
      );
    },
  );
}

function testCodexDataRootFallbacks() {
  const codexTelemetry = require('../codex/hooks/telemetry.js');
  const badRoot = path.join(tmpDir, 'bad-data-root');
  const xdgRoot = path.join(tmpDir, 'xdg-data');
  fs.writeFileSync(badRoot, 'not a directory', 'utf8');

  withEnv(
    {
      CLAUDE_PLUGIN_DATA: undefined,
      GOLDBAND_DATA_DIR: badRoot,
      GOLDBAND_USAGE_FILE: undefined,
      XDG_DATA_HOME: xdgRoot,
    },
    () => {
      assert.equal(codexTelemetry.dataRoot(), path.join(xdgRoot, 'goldband'));
      codexTelemetry.appendUsageEvent({ category: 'test', name: 'xdg' });
      assert.equal(readJsonl(codexTelemetry.usageFile()).at(-1).name, 'xdg');
    },
  );
}

function testCodexTempFallback() {
  const durableFile = path.join(tmpDir, 'durable-file');
  const xdgFile = path.join(tmpDir, 'xdg-file');
  const homeFile = path.join(tmpDir, 'home-file');
  const tempRoot = path.join(tmpDir, 'tmp-root');
  for (const filePath of [durableFile, xdgFile, homeFile]) {
    fs.writeFileSync(filePath, 'not a directory', 'utf8');
  }
  fs.mkdirSync(tempRoot, { recursive: true });

  const script = [
    "const fs = require('fs');",
    "const t = require('./codex/hooks/telemetry.js');",
    "t.appendUsageEvent({ category: 'test', name: 'temp-fallback' });",
    'console.log(JSON.stringify({',
    '  root: t.dataRoot(),',
    '  file: t.usageFile(),',
    '  events: fs.readFileSync(t.usageFile(), "utf8").trim().split("\\n").map(JSON.parse),',
    '}));',
  ].join('\n');
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: repoDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PLUGIN_DATA: '',
      GOLDBAND_DATA_DIR: durableFile,
      GOLDBAND_USAGE_FILE: '',
      XDG_DATA_HOME: xdgFile,
      HOME: homeFile,
      TMPDIR: tempRoot,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const observed = JSON.parse(result.stdout);
  assert.equal(observed.root, path.join(tempRoot, 'goldband'));
  assert.equal(
    observed.file,
    path.join(tempRoot, 'goldband', 'hook-router', 'usage-events.jsonl'),
  );
  assert.equal(observed.events.at(-1).name, 'temp-fallback');
}

function testCodexUsageRetention() {
  const codexTelemetry = require('../codex/hooks/telemetry.js');
  const retentionUsageFile = path.join(
    tmpDir,
    'retention',
    'usage-events.jsonl',
  );
  const oldRotatedFile = `${retentionUsageFile}.old`;

  withEnv(
    {
      GOLDBAND_USAGE_FILE: retentionUsageFile,
      GOLDBAND_USAGE_TELEMETRY_ENABLED: '1',
      GOLDBAND_USAGE_MAX_BYTES: '1048576',
      GOLDBAND_USAGE_RETENTION_DAYS: '1',
    },
    () => {
      fs.mkdirSync(path.dirname(retentionUsageFile), { recursive: true });
      fs.writeFileSync(oldRotatedFile, '{}\n', 'utf8');
      const oldDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      fs.utimesSync(oldRotatedFile, oldDate, oldDate);
      codexTelemetry.appendUsageEvent({ category: 'test', name: 'cleanup' });
      assert.equal(fs.existsSync(oldRotatedFile), false);
    },
  );

  const rotationUsageFile = path.join(tmpDir, 'rotation', 'usage-events.jsonl');
  withEnv(
    {
      GOLDBAND_USAGE_FILE: rotationUsageFile,
      GOLDBAND_USAGE_TELEMETRY_ENABLED: '1',
      GOLDBAND_USAGE_MAX_BYTES: '1',
      GOLDBAND_USAGE_RETENTION_DAYS: '30',
    },
    () => {
      codexTelemetry.appendUsageEvent({ category: 'test', name: 'first' });
      codexTelemetry.appendUsageEvent({ category: 'test', name: 'second' });
    },
  );

  const rotatedFiles = fs
    .readdirSync(path.dirname(rotationUsageFile))
    .filter((entry) =>
      entry.startsWith(`${path.basename(rotationUsageFile)}.`),
    );
  assert.ok(rotatedFiles.length >= 1);
  assert.equal(readJsonl(rotationUsageFile).at(-1).name, 'second');
}

function testCodexStructuredDenyTelemetryName() {
  const { hookOutcomeUsageEvents } = require('../codex/hooks/telemetry.js');
  const events = hookOutcomeUsageEvents(
    { hook_event_name: 'PreToolUse', tool_name: 'Bash' },
    {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'copy changed without matching regex',
        telemetryName: 'recursive-force-delete',
      },
    },
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].name, 'recursive-force-delete');
}

function runTelemetryFixtures() {
  runNode(claudeRouter, {
    hook_event_name: 'PreToolUse',
    tool_name: 'Skill',
    tool_input: { name: 'goldband-review' },
  });
  runNode(claudeRouter, {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'goldband-investigate --help' },
  });
  runNode(claudeRouter, {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'rg goldband-review' },
  });
  runNode(codexRouter, {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'echo goldband-review' },
  });
  runNode(codexRouter, {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'cat docs/goldband-review-notes.md' },
  });
  runNode(codexRouter, {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'git status && goldband-review --help' },
  });
  runNode(
    claudeRouter,
    {
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: 'scratch.md', content: 'temporary notes' },
    },
    {},
    2,
  );
  runNode(claudePromptHook, {
    hook_event_name: 'UserPromptSubmit',
    prompt: '/goldband-qa check this',
  });
  runNode(codexRouter, {
    hook_event_name: 'PreToolUse',
    tool_name: 'Skill',
    tool_input: { skillName: 'goldband-cso' },
  });
  runNode(codexRouter, {
    hook_event_name: 'UserPromptSubmit',
    prompt: '/goldband-ship',
  });
}

function assertTelemetryEvents() {
  const events = readJsonl(usageFile);
  assert.equal(
    hasEvent(events, {
      category: 'workflow-entry',
      name: 'goldband-review',
      confidence: 'confirmed',
      host: 'claude',
    }),
    true,
  );
  assert.equal(
    hasEvent(events, {
      category: 'workflow-entry',
      name: 'goldband-investigate',
      confidence: 'inferred',
      host: 'claude',
    }),
    true,
  );
  assert.equal(
    events.filter(
      (event) =>
        event.category === 'workflow-entry' &&
        event.name === 'goldband-review' &&
        event.confidence === 'inferred',
    ).length,
    1,
  );
  assert.equal(
    hasEvent(events, {
      category: 'workflow-entry',
      name: 'goldband-cso',
      confidence: 'confirmed',
      host: 'codex',
    }),
    true,
  );
  assert.equal(
    hasEvent(events, {
      category: 'hook-decision',
      name: 'doc-file-blocker',
      action: 'deny',
    }),
    true,
  );
}

function testTelemetryCapture() {
  runTelemetryFixtures();
  assertTelemetryEvents();
}

function testReportSummary() {
  const summary = runReportJson();
  assert.equal(summary.paths.usageFile, usageFile);
  assert.equal(summary.paths.metricsFile, metricsFile);
  assert.ok(
    summary.workflowEntries.confirmed.some(
      (row) => row.host === 'claude' && row.name === 'goldband-review',
    ),
  );
  assert.ok(
    summary.workflowEntries.inferred.some(
      (row) => row.host === 'codex' && row.name === 'goldband-ship',
    ),
  );
  assert.ok(
    summary.hooks.denies.some((row) => row.name === 'doc-file-blocker'),
  );
}

testPersistentPathAndMetricsDefault();
testCodexPluginDataRoot();
testCodexDataRootFallbacks();
testCodexTempFallback();
testCodexUsageRetention();
testCodexStructuredDenyTelemetryName();
testTelemetryCapture();
testReportSummary();

console.log('[OK] telemetry behavior verified');
