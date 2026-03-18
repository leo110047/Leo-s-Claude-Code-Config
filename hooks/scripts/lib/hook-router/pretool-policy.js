const { detectSecrets, isSecretScanExcluded } = require('./secret-patterns');
const { isModeActive } = require('./mode-state');
const { matchCarefulModeRisk } = require('./careful-mode-rules');
const { matchFreezeModeBashViolation } = require('./freeze-mode-rules');

function shouldBlockDevServer(command) {
  if (!command || process.platform === 'win32') {
    return false;
  }

  return /(npm run dev\b|pnpm( run)? dev\b|yarn dev\b|bun run dev\b)/.test(command);
}

function resolveSessionId(input) {
  return input.session_id || process.env.CLAUDE_SESSION_ID || 'default';
}

function buildModeUsageEvent(modeName, sessionId, rule, toolName, command) {
  return {
    category: 'mode-enforcement',
    name: modeName,
    action: 'block',
    sessionId: sessionId || process.env.CLAUDE_SESSION_ID || null,
    source: 'pretool-policy',
    detail: {
      rule,
      toolName,
      commandPreview: typeof command === 'string' ? command.slice(0, 160) : null
    }
  };
}

function shouldBlockDocFile(filePath) {
  if (!/\.(md|txt)$/.test(filePath)) return false;
  if (/(README|CLAUDE|AGENTS|CONTRIBUTING|SKILL)\.md$/.test(filePath)) return false;
  if (/\.claude\//.test(filePath)) return false;
  if (/\.planning\//.test(filePath)) return false;
  if (/\/reference\//.test(filePath)) return false;
  if (/\/commands\//.test(filePath)) return false;
  if (/\/docs\//.test(filePath)) return false;
  return true;
}

function evaluatePreToolUse(input) {
  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};
  const sessionId = resolveSessionId(input);
  const freezeModeActive = isModeActive(sessionId, 'freeze-mode');

  if (toolName === 'Bash') {
    const command = toolInput.command || '';
    const freezeModeViolation = freezeModeActive
      ? matchFreezeModeBashViolation(command)
      : null;

    if (freezeModeViolation) {
      return {
        decision: 'block',
        blockedBy: 'freeze-mode',
        logs: [
          '[Hook] BLOCKED: freeze-mode is active for this session',
          `[Hook] Reason: ${freezeModeViolation.detail}`,
          `[Hook] Command: ${command}`
        ],
        usageEvents: [
          buildModeUsageEvent('freeze-mode', sessionId, freezeModeViolation.rule, toolName, command)
        ]
      };
    }

    const carefulModeRisk = isModeActive(sessionId, 'careful-mode')
      ? matchCarefulModeRisk(command)
      : null;

    if (carefulModeRisk) {
      return {
        decision: 'block',
        blockedBy: 'careful-mode',
        logs: [
          '[Hook] BLOCKED: careful-mode is active for this session',
          `[Hook] Risk: ${carefulModeRisk.detail}`,
          `[Hook] Command: ${command}`,
          '[Hook] Disable with the same careful-mode script used to enable this session.'
        ],
        usageEvents: [
          buildModeUsageEvent('careful-mode', sessionId, carefulModeRisk.rule, toolName, command)
        ]
      };
    }

    if (shouldBlockDevServer(command)) {
      return {
        decision: 'block',
        blockedBy: 'dev-server-blocker',
        logs: [
          '[Hook] BLOCKED: Dev server must run in tmux for log access',
          '[Hook] Use: tmux new-session -d -s dev "npm run dev"',
          '[Hook] Then: tmux attach -t dev'
        ]
      };
    }

    if (/\bgit\s+push\b/.test(command)) {
      return {
        decision: 'allow',
        blockedBy: null,
        logs: ['[Hook] Reminder: review branch/commits/remote before git push']
      };
    }
  }

  if (freezeModeActive && (toolName === 'Edit' || toolName === 'Write')) {
    return {
      decision: 'block',
      blockedBy: 'freeze-mode',
      logs: [
        '[Hook] BLOCKED: freeze-mode allows inspection only',
        `[Hook] Tool: ${toolName}`,
        '[Hook] Disable freeze-mode before making file changes.'
      ],
      usageEvents: [
        buildModeUsageEvent('freeze-mode', sessionId, 'no-file-edits', toolName, null)
      ]
    };
  }

  if (toolName === 'Write') {
    const filePath = toolInput.file_path || '';

    if (shouldBlockDocFile(filePath)) {
      return {
        decision: 'block',
        blockedBy: 'doc-file-blocker',
        logs: [
          '[Hook] BLOCKED: Unnecessary documentation file creation',
          `[Hook] File: ${filePath}`
        ]
      };
    }
  }

  if (toolName === 'Edit' || toolName === 'Write') {
    const filePath = toolInput.file_path || '';

    if (!isSecretScanExcluded(filePath)) {
      const content = toolInput.new_string || toolInput.content || '';
      const detected = detectSecrets(content);
      const highConfidence = detected.filter(item => item.severity === 'high');
      const advisoryOnly = detected.filter(item => item.severity !== 'high');

      if (highConfidence.length > 0) {
        const detailLines = highConfidence.map(item => `  - ${item.name}`);
        return {
          decision: 'block',
          blockedBy: 'secret-detector',
          logs: [
            '[Hook] BLOCKED: Potential secrets detected in file content',
            `[Hook] File: ${filePath}`,
            '[Hook] Detected:',
            ...detailLines,
            '[Hook] Use environment variables or a secrets manager instead.'
          ]
        };
      }

      if (advisoryOnly.length > 0) {
        const detailLines = advisoryOnly.map(item => `  - ${item.name}`);
        return {
          decision: 'allow',
          blockedBy: null,
          logs: [
            '[Hook] WARNING: Potential generic secret patterns detected (advisory)',
            `[Hook] File: ${filePath}`,
            '[Hook] Review before commit:',
            ...detailLines
          ]
        };
      }
    }
  }

  return {
    decision: 'allow',
    blockedBy: null,
    logs: []
  };
}

module.exports = {
  evaluatePreToolUse
};
