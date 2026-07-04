const { detectSecrets, isSecretScanExcluded } = require('./secret-patterns');
const { isModeActive } = require('./mode-state');
const { matchCarefulModeRisk } = require('./careful-mode-rules');
const { matchFreezeModeBashViolation } = require('./freeze-mode-rules');

const PRETOOL_DENY_POLICIES = [
  {
    name: 'dev-server-blocker',
    description: 'blocks foreground development servers outside tmux',
  },
  {
    name: 'doc-file-blocker',
    description:
      'blocks ad hoc documentation file creation outside approved paths',
  },
];

function shouldBlockDevServer(command) {
  if (!command || process.platform === 'win32') {
    return false;
  }

  return /(npm run dev\b|pnpm( run)? dev\b|yarn dev\b|bun run dev\b)/.test(
    command,
  );
}

function resolveSessionId(input) {
  return input.session_id || process.env.CLAUDE_SESSION_ID || 'default';
}

function buildModeUsageEvent(options) {
  const { modeName, sessionId, rule, toolName, command } = options;
  return {
    category: 'mode-enforcement',
    name: modeName,
    action: 'block',
    sessionId: sessionId || process.env.CLAUDE_SESSION_ID || null,
    source: 'pretool-policy',
    detail: {
      rule,
      toolName,
      commandPreview:
        typeof command === 'string' ? command.slice(0, 160) : null,
    },
  };
}

function shouldBlockDocFile(filePath) {
  if (!/\.(md|txt)$/.test(filePath)) return false;
  if (
    /(README|CLAUDE|AGENTS|CONTRIBUTING|SKILL|ARCHITECTURE|DESIGN|CHANGELOG|LEARNING_PATH|OPERATIONS|VALIDATION|SECURITY|TODOS)\.md$/.test(
      filePath,
    )
  )
    return false;
  if (/\.claude\//.test(filePath)) return false;
  if (/\.planning\//.test(filePath)) return false;
  if (/\/scratchpad\//.test(filePath)) return false;
  if (/\/scratchpads\//.test(filePath)) return false;
  if (/\/reference\//.test(filePath)) return false;
  if (/\/commands\//.test(filePath)) return false;
  if (/\/docs\//.test(filePath)) return false;
  return true;
}

function buildModeBlock(options) {
  const { modeName, sessionId, rule, toolName, command, logs } = options;
  return {
    decision: 'block',
    blockedBy: modeName,
    logs,
    usageEvents: [
      buildModeUsageEvent({ modeName, sessionId, rule, toolName, command }),
    ],
  };
}

function evaluateFreezeBashPolicy(context) {
  const { command, freezeModeActive, sessionId, toolName } = context;
  const violation = freezeModeActive
    ? matchFreezeModeBashViolation(command)
    : null;
  if (!violation) return null;

  return buildModeBlock({
    modeName: 'freeze-mode',
    sessionId,
    rule: violation.rule,
    toolName,
    command,
    logs: [
      '[Hook] BLOCKED: freeze-mode is active for this session',
      `[Hook] Reason: ${violation.detail}`,
      `[Hook] Command: ${command}`,
    ],
  });
}

function evaluateCarefulBashPolicy(context) {
  const { command, sessionId, toolName } = context;
  const risk = isModeActive(sessionId, 'careful-mode')
    ? matchCarefulModeRisk(command)
    : null;
  if (!risk) return null;

  return buildModeBlock({
    modeName: 'careful-mode',
    sessionId,
    rule: risk.rule,
    toolName,
    command,
    logs: [
      '[Hook] BLOCKED: careful-mode is active for this session',
      `[Hook] Risk: ${risk.detail}`,
      `[Hook] Command: ${command}`,
      '[Hook] Disable with the same careful-mode script used to enable this session.',
    ],
  });
}

function evaluateBashPolicy(context) {
  const { command } = context;
  const modeDecision =
    evaluateFreezeBashPolicy(context) || evaluateCarefulBashPolicy(context);
  if (modeDecision) return modeDecision;

  if (shouldBlockDevServer(command)) {
    return {
      decision: 'block',
      blockedBy: 'dev-server-blocker',
      logs: [
        '[Hook] BLOCKED: Dev server must run in tmux for log access',
        '[Hook] Use: tmux new-session -d -s dev "npm run dev"',
        '[Hook] Then: tmux attach -t dev',
      ],
    };
  }

  if (/\bgit\s+push\b/.test(command)) {
    return {
      decision: 'allow',
      blockedBy: null,
      logs: ['[Hook] Reminder: review branch/commits/remote before git push'],
    };
  }

  return null;
}

function evaluateFreezeFilePolicy(context) {
  const { freezeModeActive, sessionId, toolName } = context;
  if (!freezeModeActive || (toolName !== 'Edit' && toolName !== 'Write')) {
    return null;
  }

  return buildModeBlock({
    modeName: 'freeze-mode',
    sessionId,
    rule: 'no-file-edits',
    toolName,
    command: null,
    logs: [
      '[Hook] BLOCKED: freeze-mode allows inspection only',
      `[Hook] Tool: ${toolName}`,
      '[Hook] Disable freeze-mode before making file changes.',
    ],
  });
}

function evaluateWritePolicy(context) {
  const { filePath, toolName } = context;
  if (toolName !== 'Write' || !shouldBlockDocFile(filePath)) {
    return null;
  }

  return {
    decision: 'block',
    blockedBy: 'doc-file-blocker',
    logs: [
      '[Hook] BLOCKED: Unnecessary documentation file creation',
      `[Hook] File: ${filePath}`,
    ],
  };
}

function buildSecretDecision(filePath, detected) {
  const highConfidence = detected.filter((item) => item.severity === 'high');
  const advisoryOnly = detected.filter((item) => item.severity !== 'high');

  if (highConfidence.length > 0) {
    const detailLines = highConfidence.map((item) => `  - ${item.name}`);
    return {
      decision: 'block',
      blockedBy: 'secret-detector',
      logs: [
        '[Hook] BLOCKED: Potential secrets detected in file content',
        `[Hook] File: ${filePath}`,
        '[Hook] Detected:',
        ...detailLines,
        '[Hook] Use environment variables or a secrets manager instead.',
      ],
    };
  }

  if (advisoryOnly.length > 0) {
    const detailLines = advisoryOnly.map((item) => `  - ${item.name}`);
    return {
      decision: 'allow',
      blockedBy: null,
      logs: [
        '[Hook] WARNING: Potential generic secret patterns detected (advisory)',
        `[Hook] File: ${filePath}`,
        '[Hook] Review before commit:',
        ...detailLines,
      ],
    };
  }

  return null;
}

function evaluateSecretPolicy(context) {
  const { filePath, toolInput, toolName } = context;
  if (toolName !== 'Edit' && toolName !== 'Write') return null;
  if (isSecretScanExcluded(filePath)) return null;

  const content = toolInput.new_string || toolInput.content || '';
  return buildSecretDecision(filePath, detectSecrets(content));
}

function evaluatePreToolUse(input) {
  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};
  const sessionId = resolveSessionId(input);
  const context = {
    toolName,
    toolInput,
    sessionId,
    command: toolInput.command || '',
    filePath: toolInput.file_path || '',
    freezeModeActive: isModeActive(sessionId, 'freeze-mode'),
  };

  const decision =
    (toolName === 'Bash' ? evaluateBashPolicy(context) : null) ||
    evaluateFreezeFilePolicy(context) ||
    evaluateWritePolicy(context) ||
    evaluateSecretPolicy(context);

  if (decision) return decision;

  return {
    decision: 'allow',
    blockedBy: null,
    logs: [],
  };
}

module.exports = {
  PRETOOL_DENY_POLICIES,
  evaluatePreToolUse,
};
