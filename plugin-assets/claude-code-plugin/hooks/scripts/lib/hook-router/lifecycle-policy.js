const fs = require('fs');
const path = require('path');
const { getPersistentDataPath } = require('../utils');

const DEFAULT_DEDUPE_RETENTION_DAYS = 30;

function buildAdditionalContext(hookEventName, additionalContext) {
  return {
    hookSpecificOutput: {
      hookEventName,
      additionalContext,
    },
  };
}

function sessionId(input) {
  return (
    input.session_id || input.sessionId || process.env.CLAUDE_SESSION_ID || null
  );
}

function markerSegment(value) {
  return String(value || '').replace(/[^A-Za-z0-9._-]/g, '_');
}

function parsePositiveInt(value, fallback) {
  const parsed = parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function cleanupExpiredMarkers(markerDir) {
  try {
    const retentionDays = parsePositiveInt(
      process.env.GOLDBAND_DEDUPE_RETENTION_DAYS,
      DEFAULT_DEDUPE_RETENTION_DAYS,
    );
    const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
    const nowMs = Date.now();

    for (const entry of fs.readdirSync(markerDir)) {
      const markerPath = path.join(markerDir, entry);
      try {
        const stats = fs.statSync(markerPath);
        if (stats.isFile() && nowMs - stats.mtimeMs > retentionMs) {
          fs.unlinkSync(markerPath);
        }
      } catch {
        // Ignore one-marker cleanup failures.
      }
    }
  } catch {
    // Dedupe cleanup must never block hook execution.
  }
}

function markOnce(input, advisoryName) {
  const id = sessionId(input);
  if (!id) return true;

  const markerDir = getPersistentDataPath(
    'hook-router',
    'dedupe',
    markerSegment(advisoryName),
  );
  const markerPath = path.join(markerDir, `${markerSegment(id)}.json`);
  let fd = null;

  try {
    fs.mkdirSync(markerDir, { recursive: true });
    cleanupExpiredMarkers(markerDir);
    fd = fs.openSync(markerPath, 'wx');
    fs.writeFileSync(
      fd,
      JSON.stringify({
        advisoryName,
        sessionId: id,
        hookEventName: input.hook_event_name || null,
        recordedAt: new Date().toISOString(),
      }),
      'utf8',
    );
    return true;
  } catch (error) {
    if (error && error.code === 'EEXIST') return false;
    return true;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

function allowOutcome(extra = {}) {
  return {
    decision: 'allow',
    blockedBy: null,
    logs: [],
    ...extra,
  };
}

function evaluateSessionStart(input) {
  if (!markOnce(input, 'session-start-context-restore-hint')) {
    return allowOutcome({ outputJson: null });
  }

  return allowOutcome({
    logs: [
      '[Hook] SessionStart: context restore is available via /goldband-context-restore when needed.',
    ],
    outputJson: buildAdditionalContext(
      'SessionStart',
      'For resumed or context-sensitive work, prefer /goldband-context-restore before editing.',
    ),
  });
}

function evaluatePostToolUseFailure(input) {
  const toolName = input.tool_name || 'unknown tool';
  const error = input.error || 'unknown failure';
  return allowOutcome({
    logs: [`[Hook] Tool failure observed in ${toolName}: ${error}`],
    outputJson: buildAdditionalContext(
      'PostToolUseFailure',
      'A tool failed. Capture the exact failure and follow systematic debugging before proposing fixes.',
    ),
  });
}

function evaluateLifecycle(input) {
  const eventName = input.hook_event_name || '';

  if (eventName === 'SessionStart') {
    return evaluateSessionStart(input);
  }

  if (eventName === 'PostToolUseFailure') {
    return evaluatePostToolUseFailure(input);
  }

  if (eventName === 'PreCompact') {
    return allowOutcome({
      logs: [
        '[Hook] PreCompact: preserve active goal, verification state, and blockers in the compact summary.',
      ],
    });
  }

  if (eventName === 'PostCompact') {
    return allowOutcome({
      logs: [
        '[Hook] PostCompact: re-check current files before making completion claims.',
      ],
    });
  }

  if (eventName === 'SessionEnd') {
    return allowOutcome({
      logs: [
        '[Hook] SessionEnd: context save is available via /goldband-context-save for reusable handoff state.',
      ],
    });
  }

  return allowOutcome();
}

module.exports = {
  evaluateLifecycle,
};
