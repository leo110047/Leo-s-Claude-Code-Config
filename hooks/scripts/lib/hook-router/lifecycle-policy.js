function buildAdditionalContext(hookEventName, additionalContext) {
  return {
    hookSpecificOutput: {
      hookEventName,
      additionalContext
    }
  };
}

function evaluateLifecycle(input) {
  const eventName = input.hook_event_name || '';

  if (eventName === 'SessionStart') {
    return {
      decision: 'allow',
      blockedBy: null,
      logs: ['[Hook] SessionStart: context restore is available via /goldband-context-restore when needed.'],
      outputJson: buildAdditionalContext(
        'SessionStart',
        'For resumed or context-sensitive work, prefer /goldband-context-restore before editing.'
      )
    };
  }

  if (eventName === 'PostToolUseFailure') {
    const toolName = input.tool_name || 'unknown tool';
    const error = input.error || 'unknown failure';
    return {
      decision: 'allow',
      blockedBy: null,
      logs: [`[Hook] Tool failure observed in ${toolName}: ${error}`],
      outputJson: buildAdditionalContext(
        'PostToolUseFailure',
        'A tool failed. Capture the exact failure and follow systematic debugging before proposing fixes.'
      )
    };
  }

  if (eventName === 'PreCompact') {
    return {
      decision: 'allow',
      blockedBy: null,
      logs: ['[Hook] PreCompact: preserve active goal, verification state, and blockers in the compact summary.']
    };
  }

  if (eventName === 'PostCompact') {
    return {
      decision: 'allow',
      blockedBy: null,
      logs: ['[Hook] PostCompact: re-check current files before making completion claims.']
    };
  }

  if (eventName === 'SessionEnd') {
    return {
      decision: 'allow',
      blockedBy: null,
      logs: ['[Hook] SessionEnd: context save is available via /goldband-context-save for reusable handoff state.']
    };
  }

  return {
    decision: 'allow',
    blockedBy: null,
    logs: []
  };
}

module.exports = {
  evaluateLifecycle
};
