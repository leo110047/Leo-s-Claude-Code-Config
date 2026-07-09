const { detectSecrets, isSecretScanExcluded } = require('./secret-patterns');
const { isModeActive, setModeActive } = require('./mode-state');
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

const REVIEW_READ_ONLY_MODE = 'review-read-only';
const READ_ONLY_WORKFLOW_SKILL_ALIASES = new Map([
  ['goldband-review', 'goldband-review'],
  ['review', 'goldband-review'],
]);
const READ_ONLY_WORKFLOW_SKILLS = new Set(['goldband-review']);
const REVIEW_RUNTIME_WRITE_PATH =
  /(?:~\/\.goldband\b|\$GOLDBAND_[A-Z0-9_]+|\$\{GOLDBAND_[A-Z0-9_]+\}|\/tmp\/|\/private\/tmp\/|\$TMP(?:DIR|ERR|[A-Z0-9_]*)?\b|\$\{TMP(?:DIR|ERR|[A-Z0-9_]*)?\}|mktemp|\/dev\/null)/;

function safeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeWorkflowSkillName(value) {
  const normalized = safeString(value).replace(/^\/+/, '').toLowerCase();
  return READ_ONLY_WORKFLOW_SKILL_ALIASES.get(normalized) || null;
}

function candidateSkillNames(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return [];
  return [
    toolInput.name,
    toolInput.skill,
    toolInput.skill_name,
    toolInput.skillName,
    toolInput.command,
  ]
    .map(normalizeWorkflowSkillName)
    .filter(Boolean);
}

function isReadOnlyWorkflowSkillInvocation(toolName, toolInput) {
  if (!/^Skill$/i.test(toolName || '')) return false;
  return candidateSkillNames(toolInput).some((name) =>
    READ_ONLY_WORKFLOW_SKILLS.has(name),
  );
}

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
  if (/(^|\/)rules\//.test(filePath)) return false;
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

function shellWords(value) {
  return (
    String(value || '')
      .match(/"[^"]*"|'[^']*'|\S+/g)
      ?.map((token) => token.replace(/^['"]|['"]$/g, '')) || []
  );
}

function isRuntimeWriteTarget(token) {
  return REVIEW_RUNTIME_WRITE_PATH.test(token);
}

function mutationTargetsAreRuntime(command, args) {
  const tokens = shellWords(args).filter(
    (token) => token && !token.startsWith('-'),
  );
  if (tokens.length === 0) return false;
  if (command === 'cp' || command === 'mv') {
    return isRuntimeWriteTarget(tokens[tokens.length - 1]);
  }
  if (command === 'chmod' || command === 'chown') {
    return tokens.slice(1).every(isRuntimeWriteTarget);
  }
  return tokens.every(isRuntimeWriteTarget);
}

function reviewReadOnlyBashViolation(command) {
  if (!command) return null;

  const rawCommand = String(command);
  const normalized = rawCommand.replace(/\s+/g, ' ').trim();
  const gitMutation = normalized.match(
    /\bgit\s+(add|commit|push|reset|checkout|switch|clean|merge(?!-)|rebase|cherry-pick|apply|am|restore|stash)\b/,
  );
  if (gitMutation) {
    return {
      rule: 'no-source-mutation',
      detail: `review-read-only blocks git ${gitMutation[1]}`,
    };
  }

  const packageMutation = normalized.match(
    /\b(npm|pnpm|yarn|bun)\s+(install|add|remove|update|upgrade)\b/,
  );
  if (packageMutation) {
    return {
      rule: 'no-source-mutation',
      detail: `review-read-only blocks ${packageMutation[1]} ${packageMutation[2]}`,
    };
  }

  const sedInPlace = normalized.match(/\bsed\s+[^|;&\n]*\s-i(?:\s|$)/);
  if (sedInPlace) {
    return {
      rule: 'no-source-mutation',
      detail: 'review-read-only blocks in-place file edits',
    };
  }

  const fsMutationPattern =
    /\b(touch|mkdir|rm|mv|cp|chmod|chown)\b([^|;&\n]*)/g;
  for (const match of rawCommand.matchAll(fsMutationPattern)) {
    const args = match[2] || '';
    if (!mutationTargetsAreRuntime(match[1], args)) {
      return {
        rule: 'no-source-mutation',
        detail: `review-read-only blocks ${match[1]} outside runtime artifact paths`,
      };
    }
  }

  const redirectPattern =
    /(?:^|[^0-9])(?:>{1,2})(?!\s*(?:&[0-9]|\/dev\/null\b|["']?\$TMP|["']?\$\{TMP|["']?~\/\.goldband\b|["']?\/tmp\/|["']?\/private\/tmp\/))/g;
  if (redirectPattern.test(rawCommand)) {
    return {
      rule: 'no-source-mutation',
      detail:
        'review-read-only blocks shell redirection outside runtime artifact paths',
    };
  }

  return null;
}

function evaluateReadOnlyWorkflowActivation(context) {
  const { sessionId, toolInput, toolName } = context;
  if (!isReadOnlyWorkflowSkillInvocation(toolName, toolInput)) return null;

  try {
    setModeActive(sessionId, REVIEW_READ_ONLY_MODE, true, {
      source: 'goldband-review',
      reason: 'read-only workflow skill',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      decision: 'block',
      blockedBy: REVIEW_READ_ONLY_MODE,
      logs: [
        '[Hook] BLOCKED: could not enforce read-only review mode',
        `[Hook] Reason: ${message}`,
      ],
    };
  }

  return {
    decision: 'allow',
    blockedBy: null,
    logs: [],
  };
}

function evaluateReviewReadOnlyBashPolicy(context) {
  const { command, reviewReadOnlyActive, sessionId, toolName } = context;
  const violation = reviewReadOnlyActive
    ? reviewReadOnlyBashViolation(command)
    : null;
  if (!violation) return null;

  return buildModeBlock({
    modeName: REVIEW_READ_ONLY_MODE,
    sessionId,
    rule: violation.rule,
    toolName,
    command,
    logs: [
      '[Hook] BLOCKED: review-read-only is active for this session',
      `[Hook] Reason: ${violation.detail}`,
      `[Hook] Command: ${command}`,
    ],
  });
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
    evaluateReviewReadOnlyBashPolicy(context) ||
    evaluateFreezeBashPolicy(context) ||
    evaluateCarefulBashPolicy(context);
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

function evaluateReviewReadOnlyFilePolicy(context) {
  const { reviewReadOnlyActive, sessionId, toolName } = context;
  if (
    !reviewReadOnlyActive ||
    !['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(toolName)
  ) {
    return null;
  }

  return buildModeBlock({
    modeName: REVIEW_READ_ONLY_MODE,
    sessionId,
    rule: 'no-file-edits',
    toolName,
    command: null,
    logs: [
      '[Hook] BLOCKED: review-read-only allows source inspection only',
      `[Hook] Tool: ${toolName}`,
      '[Hook] Finish the review turn before making file changes.',
    ],
  });
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
    reviewReadOnlyActive: isModeActive(sessionId, REVIEW_READ_ONLY_MODE),
  };

  const decision =
    evaluateReadOnlyWorkflowActivation(context) ||
    (toolName === 'Bash' ? evaluateBashPolicy(context) : null) ||
    evaluateReviewReadOnlyFilePolicy(context) ||
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
