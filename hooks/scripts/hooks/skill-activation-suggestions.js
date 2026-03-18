#!/usr/bin/env node

const { readStdinJson } = require('../lib/utils');
const { appendUsageEvent } = require('../lib/hook-router/usage-telemetry');
const { formatSuggestions, matchPrompt } = require('../lib/skill-activation/activation-rules');
const { shouldEmitSuggestions } = require('../lib/skill-activation/session-state');

function buildMatchUsageEvents(matches, sessionId, prompt) {
  return matches.map(match => ({
    category: 'prompt-trigger',
    name: match.skill,
    action: 'matched',
    sessionId,
    source: 'skill-activation-suggestions',
    detail: {
      priority: match.priority,
      score: match.score,
      matchedKeywords: match.matchedKeywords,
      matchedPatterns: match.matchedPatterns,
      promptPreview: String(prompt || '').slice(0, 160)
    }
  }));
}

function buildSuggestionUsageEvent(matches, sessionId) {
  return {
    category: 'prompt-trigger',
    name: 'skill-activation-suggestions',
    action: 'suggested',
    sessionId,
    source: 'skill-activation-suggestions',
    detail: {
      skills: matches.map(match => match.skill)
    }
  };
}

async function main() {
  const input = await readStdinJson();
  const prompt = String(input.prompt || '');
  const sessionId = input.session_id || process.env.CLAUDE_SESSION_ID || null;
  const matches = matchPrompt(prompt);

  for (const event of buildMatchUsageEvents(matches, sessionId, prompt)) {
    appendUsageEvent(event);
  }

  const suggestedSkills = matches.slice(0, 3).map(match => match.skill);
  const shouldEmit = suggestedSkills.length > 0 && shouldEmitSuggestions(sessionId, suggestedSkills);

  if (!shouldEmit) {
    process.stdout.write('{}');
    return;
  }

  appendUsageEvent(buildSuggestionUsageEvent(matches.slice(0, 3), sessionId));

  const additionalContext = formatSuggestions(matches, 3);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext
    }
  }));
}

main().catch(() => {
  process.stdout.write('{}');
});
