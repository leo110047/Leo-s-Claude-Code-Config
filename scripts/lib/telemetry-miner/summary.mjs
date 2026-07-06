import { DEFAULT_DAYS, DEFAULT_LIMIT } from './constants.mjs';
import {
  dataWindow,
  increment,
  readUsageTelemetry,
  readWorkflowEvidence,
  scopedRows,
  sortedCounts,
} from './io.mjs';

export function buildSummary(options = {}) {
  const usage = readUsageTelemetry(options);
  const workflow = readWorkflowEvidence(options);
  const days = options.days || DEFAULT_DAYS;
  const limit = options.limit || DEFAULT_LIMIT;
  const usageEvents = scopedRows(usage.events, days, 'recordedAt');
  const workflowEvents = scopedRows(workflow.events, days, 'startedAt');

  return {
    generatedAt: new Date().toISOString(),
    days,
    sample_status: sampleStatus(usageEvents, workflowEvents),
    inputs: inputSummary(usage, workflow),
    dataWindow: dataWindow([...usageEvents, ...workflowEvents]),
    totals: {
      usageEvents: usageEvents.length,
      workflowEvidenceEvents: workflowEvents.length,
      uniqueRuns: uniqueRunCount(usageEvents, workflowEvents),
    },
    denyBlockByRule: summarizeDenyBlockByRule(usageEvents, limit),
    workflowEntries: summarizeWorkflowEntries(usageEvents, limit),
    crossReviewVerdicts: summarizeCrossReviewVerdicts(usageEvents, limit),
    modeEnforcement: summarizeModeEnforcement(usageEvents, limit),
    workflowEvidence: summarizeWorkflowEvidence(workflowEvents, limit),
  };
}

export function printSummaryMarkdown(summary) {
  const lines = [];
  lines.push('# Goldband Telemetry Mining Summary');
  lines.push('');
  lines.push(`Generated: ${summary.generatedAt}`);
  lines.push(`Window: ${summary.days} day(s)`);
  lines.push(`Sample status: ${summary.sample_status}`);
  lines.push(`Data range: ${formatRange(summary.dataWindow)}`);
  lines.push(
    `Events: usage ${summary.totals.usageEvents}, workflow evidence ${summary.totals.workflowEvidenceEvents}, runs ${summary.totals.uniqueRuns}`,
  );
  lines.push('');
  appendRows(
    lines,
    'Deny / Block By Rule',
    summary.denyBlockByRule,
    (row) => `${row.category}/${row.action}/${row.name}: ${row.count}`,
  );
  appendRows(
    lines,
    'Workflow Entries',
    summary.workflowEntries,
    (row) =>
      `${row.host}/${row.name}/${row.confidence}/${row.action}: ${row.count}`,
  );
  appendRows(
    lines,
    'Cross-Review Verdicts',
    summary.crossReviewVerdicts,
    (row) => `${row.name}/${row.verdict}: ${row.count}`,
  );
  appendRows(
    lines,
    'Mode Enforcement',
    summary.modeEnforcement,
    (row) => `${row.name}/${row.rule}: ${row.count}`,
  );
  appendRows(
    lines,
    'Workflow Evidence',
    summary.workflowEvidence,
    (row) => `${row.name}/${row.status}: ${row.count}`,
  );
  return `${lines.join('\n')}\n`;
}

function sampleStatus(usageEvents, workflowEvents) {
  return usageEvents.length + workflowEvents.length > 0
    ? 'ok'
    : 'insufficient-data';
}

function inputSummary(usage, workflow) {
  return {
    usageFile: usage.requestedFile,
    usageFiles: usage.files,
    usageBadLineCount: usage.badLineCount,
    workflowRunsDir: workflow.requestedDir,
    workflowRunFiles: workflow.files,
    workflowBadLineCount: workflow.badLineCount,
  };
}

function uniqueRunCount(usageEvents, workflowEvents) {
  const ids = new Set();
  for (const event of usageEvents) if (event.run_id) ids.add(event.run_id);
  for (const event of workflowEvents) if (event.runId) ids.add(event.runId);
  return ids.size;
}

function summarizeDenyBlockByRule(events, limit) {
  const counts = new Map();
  for (const event of events) {
    if (!['deny', 'block'].includes(event.action)) continue;
    const name = event.name || event.detail?.rule || 'unknown';
    increment(counts, `${event.category}|${event.action}|${name}`, {
      category: event.category,
      action: event.action,
      name,
      host: event.host || event.detail?.host || 'unknown',
    });
  }
  return sortedCounts(counts, limit);
}

function summarizeWorkflowEntries(events, limit) {
  const counts = new Map();
  for (const event of events) {
    if (event.category !== 'workflow-entry') continue;
    const name = event.name || 'unknown';
    const confidence = event.confidence || 'unknown';
    increment(counts, `${event.host}|${name}|${confidence}|${event.action}`, {
      host: event.host || 'unknown',
      name,
      confidence,
      action: event.action || 'unknown',
    });
  }
  return sortedCounts(counts, limit);
}

function summarizeCrossReviewVerdicts(events, limit) {
  const counts = new Map();
  for (const event of events) {
    if (!String(event.name || '').startsWith('cross-review-')) continue;
    const verdict =
      event.detail?.verdict ||
      event.detail?.status ||
      event.action ||
      'unknown';
    increment(counts, `${event.name}|${verdict}`, {
      name: event.name,
      verdict,
      action: event.action || 'record',
    });
  }
  return sortedCounts(counts, limit);
}

function summarizeModeEnforcement(events, limit) {
  const counts = new Map();
  for (const event of events) {
    if (event.category !== 'mode-enforcement') continue;
    const rule = event.detail?.rule || event.name || 'unknown';
    increment(counts, `${event.name}|${rule}`, {
      name: event.name || 'unknown',
      rule,
      action: event.action || 'block',
    });
  }
  return sortedCounts(counts, limit);
}

function summarizeWorkflowEvidence(events, limit) {
  const counts = new Map();
  for (const event of events) {
    const name = event.workflow || 'unknown';
    const status = event.status || 'unknown';
    increment(counts, `${name}|${status}`, { name, status });
  }
  return sortedCounts(counts, limit);
}

function appendRows(lines, title, rows, formatRow) {
  lines.push(`## ${title}`);
  if (rows.length === 0) {
    lines.push('- none');
  } else {
    for (const row of rows) lines.push(`- ${formatRow(row)}`);
  }
  lines.push('');
}

function formatRange(window) {
  return `${window.firstRecordedAt || 'none'} -> ${window.lastRecordedAt || 'none'}`;
}
