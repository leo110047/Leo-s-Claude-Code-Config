const path = require('path');
const {
  getPersistentDataPath,
  readFile,
  writeFile
} = require('../utils');

function normalizeSessionId(sessionId) {
  const raw = String(sessionId || process.env.CLAUDE_SESSION_ID || 'default').trim();
  return (raw.length > 0 ? raw : 'default').replace(/[^a-zA-Z0-9._-]/g, '-');
}

function resolveStateFile(sessionId) {
  const safeSessionId = normalizeSessionId(sessionId);
  return getPersistentDataPath('skill-activation', `session-${safeSessionId}.json`);
}

function readState(sessionId) {
  const filePath = resolveStateFile(sessionId);
  const raw = readFile(filePath);
  if (!raw) {
    return {
      sessionId: normalizeSessionId(sessionId),
      lastSuggestedSkills: [],
      filePath
    };
  }

  try {
    const parsed = JSON.parse(raw);
    const lastSuggestedSkills = Array.isArray(parsed.lastSuggestedSkills)
      ? parsed.lastSuggestedSkills.filter(item => typeof item === 'string')
      : [];

    return {
      sessionId: normalizeSessionId(parsed.sessionId || sessionId),
      lastSuggestedSkills,
      filePath
    };
  } catch {
    return {
      sessionId: normalizeSessionId(sessionId),
      lastSuggestedSkills: [],
      filePath
    };
  }
}

function sameSkillList(left, right) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function shouldEmitSuggestions(sessionId, skills) {
  const state = readState(sessionId);
  const normalizedSkills = [...skills].sort();

  if (sameSkillList(state.lastSuggestedSkills, normalizedSkills)) {
    return false;
  }

  writeFile(state.filePath, JSON.stringify({
    sessionId: state.sessionId,
    updatedAt: new Date().toISOString(),
    lastSuggestedSkills: normalizedSkills
  }, null, 2) + '\n');

  return true;
}

module.exports = {
  normalizeSessionId,
  shouldEmitSuggestions
};
