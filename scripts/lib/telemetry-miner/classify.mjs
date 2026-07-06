import {
  CLASSIFICATION_CONFIDENCE,
  DEFAULT_DAYS,
  DEFAULT_LIMIT,
  TAXONOMY,
} from './constants.mjs';
import {
  dataWindow,
  increment,
  readUsageTelemetry,
  readWorkflowEvidence,
  scopedRows,
  sortedCounts,
} from './io.mjs';
import { anonymizedId, sanitizeEvent } from './sanitize.mjs';

export function classifyTelemetry(options = {}) {
  const usage = readUsageTelemetry(options);
  const workflow = readWorkflowEvidence(options);
  const days = options.days || DEFAULT_DAYS;
  const usageEvents = scopedRows(usage.events, days, 'recordedAt');
  const workflowEvents = scopedRows(workflow.events, days, 'startedAt');
  const classifications = [
    ...usageClassifications(usageEvents),
    ...workflowClassifications(workflowEvents),
  ].filter(Boolean);
  const visibleClassifications = classifications.slice(
    0,
    options.limit || DEFAULT_LIMIT,
  );

  return {
    generatedAt: new Date().toISOString(),
    sample_status: classifications.length > 0 ? 'ok' : 'insufficient-data',
    dataWindow: dataWindow([...usageEvents, ...workflowEvents]),
    classifications: visibleClassifications,
    totals: summarizeClassifications(visibleClassifications),
    totalClassifications: classifications.length,
  };
}

function usageClassifications(events) {
  return events.map((event) => classifyUsageEvent(event, events));
}

function workflowClassifications(events) {
  return events.map(classifyWorkflowEvent);
}

function classifyUsageEvent(event, allEvents) {
  if (event.category === 'mode-enforcement' && event.action === 'block') {
    return classificationFor(event, 'mode-enforcement-block', [
      'category',
      'action',
      'name',
      'detail.rule',
      'detail.toolName',
      'detail.commandPreview',
    ]);
  }

  if (isCrossReviewRejection(event)) {
    return classificationFor(event, 'cross-review-rejection', [
      'name',
      'action',
      'detail.verdict',
      'detail.blockingCount',
      'detail.summaryPath',
    ]);
  }

  if (event.category === 'hook-decision' && event.action === 'deny') {
    return classificationFor(event, denyCategory(event, allEvents), [
      'category',
      'action',
      'name',
      'detail.hookEventName',
      'detail.toolName',
      'recordedAt',
    ]);
  }

  return null;
}

function isCrossReviewRejection(event) {
  if (!String(event.name || '').startsWith('cross-review-')) return false;
  const verdict = event.detail?.verdict || event.action || '';
  return (
    event.action === 'deny' ||
    event.action === 'block' ||
    event.name === 'cross-review-escalation' ||
    ['CHANGES_REQUESTED', 'ESCALATE', 'deny', 'block'].includes(verdict)
  );
}

function denyCategory(event, allEvents) {
  return isPossibleFalsePositive(event, allEvents)
    ? 'false-positive-deny'
    : 'true-deny';
}

function isPossibleFalsePositive(event, allEvents) {
  const eventTime = Date.parse(event.recordedAt || '');
  if (!Number.isFinite(eventTime)) return false;
  return allEvents.some((candidate) =>
    isNearbyNonBlockingSignal(event, candidate, eventTime),
  );
}

function isNearbyNonBlockingSignal(event, candidate, eventTime) {
  if (candidate === event) return false;
  if (runId(candidate) !== runId(event)) return false;
  if (['deny', 'block'].includes(candidate.action)) return false;
  if (!toolMatches(event, candidate)) return false;
  const candidateTime = Date.parse(candidate.recordedAt || '');
  return isWithinWindow(candidateTime, eventTime, 30 * 60 * 1000);
}

function runId(event) {
  return event.run_id || event.sessionId || null;
}

function toolMatches(event, candidate) {
  const toolName = event.detail?.toolName;
  const candidateTool = candidate.detail?.toolName;
  return !toolName || !candidateTool || candidateTool === toolName;
}

function isWithinWindow(candidateTime, eventTime, windowMs) {
  return (
    Number.isFinite(candidateTime) &&
    candidateTime > eventTime &&
    candidateTime - eventTime <= windowMs
  );
}

function classifyWorkflowEvent(event) {
  if (!['failed', 'skipped'].includes(event.status)) return null;
  return classificationFor(event, 'workflow-drift', [
    'workflow',
    'step',
    'status',
    'error',
    'startedAt',
  ]);
}

function classificationFor(event, category, evidenceFields) {
  const sanitized = sanitizeEvent(event);
  if (!sanitized.retained) return null;
  return {
    category,
    source_event_id: sourceEventId(event),
    evidence_fields: evidenceFields,
    confidence: CLASSIFICATION_CONFIDENCE,
    needs_human_label: true,
    sanitized_example: sanitized.value,
    rationale: TAXONOMY[category].meaning,
    suggested_action: TAXONOMY[category].action,
  };
}

function sourceEventId(event) {
  return anonymizedId(event.event_id || workflowEventKey(event), 'evt');
}

function workflowEventKey(event) {
  return `${event.workflow || 'workflow'}:${event.runId || event.run_id}:${event.step || event.name}`;
}

function summarizeClassifications(classifications) {
  const counts = new Map();
  for (const item of classifications) {
    increment(counts, item.category, { name: item.category });
  }
  return sortedCounts(counts, classifications.length || DEFAULT_LIMIT);
}
