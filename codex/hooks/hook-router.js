#!/usr/bin/env node

const MAX_STDIN_BYTES = 1024 * 1024;
const HIGH_RISK_SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bghp_[A-Za-z0-9_]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/
];

const ADVISORY_SECRET_PATTERNS = [
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/,
  /(?:api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token)\s*[=:]\s*['"][A-Za-z0-9_-]{20,}['"]/i
];

const WORKFLOW_HINTS = [
  {
    name: 'review',
    pattern: /\b(code\s*review|review|pr\s*review)\b|審查|檢查/i,
    message: 'For full code review, prefer /goldband-review. Use bounded reviewer agents only as a second pass.'
  },
  {
    name: 'debug',
    pattern: /\b(debug|bug|error|failure|failing|failed|root cause|regression)\b|除錯|錯誤|失敗|異常|根因/i,
    message: 'For bugs or failing commands, capture the exact failure first and prefer /goldband-investigate before fixing.'
  },
  {
    name: 'security',
    pattern: /\b(security|secret|token|credential|auth|permission|cve|vulnerability)\b|安全|權限|憑證|密鑰|漏洞/i,
    message: 'For security-sensitive work, prefer /goldband-cso or the security checklist before changing behavior.'
  },
  {
    name: 'planning',
    pattern: /\b(plan|planning|proposal|roadmap|architecture|design)\b|計畫|規劃|拆解|架構/i,
    message: 'For multi-file or risky planning, prefer /plan and use /goldband-plan-eng-review before implementation.'
  }
];

function readStdinRaw() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      if (data.length < MAX_STDIN_BYTES) {
        data += chunk;
      }
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

function parseInput(raw) {
  try {
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeJson(value) {
  process.stdout.write(JSON.stringify(value));
}

function buildAdditionalContextOutput(hookEventName, additionalContext) {
  return {
    hookSpecificOutput: {
      hookEventName,
      additionalContext
    }
  };
}

function buildSystemMessageOutput(message) {
  return { systemMessage: message };
}

function buildPreToolUseDeny(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason
    }
  };
}

function buildPermissionRequestDeny(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: {
        behavior: 'deny',
        message: reason
      }
    }
  };
}

function resultAdditionalContext(hookEventName, additionalContext) {
  return buildAdditionalContextOutput(hookEventName, additionalContext);
}

function resultSystemMessage(message) {
  return buildSystemMessageOutput(message);
}

function resultPreToolUseDeny(reason) {
  return buildPreToolUseDeny(reason);
}

function resultPermissionRequestDeny(reason) {
  return buildPermissionRequestDeny(reason);
}

function writeResult(result) {
  if (result) writeJson(result);
}

function secretWarningForPatch(command) {
  const patch = String(command || '');
  if (ADVISORY_SECRET_PATTERNS.some(pattern => pattern.test(patch))) {
    return 'Patch content contains credential-shaped text. Verify it is a fixture/example and not a real secret before committing.';
  }
  return null;
}

function buildPostToolUseFailureContext(input) {
  const toolName = input.tool_name || 'unknown tool';
  const response = input.tool_response || {};
  const exitCode = response.exit_code ?? response.exitCode;
  if (exitCode && Number(exitCode) !== 0) {
    return resultAdditionalContext(
      'PostToolUse',
      `${toolName} exited non-zero. Capture the exact failure and follow systematic debugging before fixing.`
    );
  }

  return null;
}

function buildPostToolUsePatchContext(input) {
  const command = input.tool_input?.command || '';
  if (input.tool_name !== 'apply_patch') return null;

  const messages = [];
  if (/console\.log/.test(command)) {
    messages.push('The patch contains console.log. Verify it is intentional before committing.');
  }

  if (messages.length === 0) return null;
  return resultAdditionalContext('PostToolUse', messages.join(' '));
}

function evaluatePostToolUseResult(input) {
  return buildPostToolUseFailureContext(input) || buildPostToolUsePatchContext(input);
}

function evaluateSubagentStopResult(input) {
  const message = input.last_assistant_message || '';
  if (hasCompletionClaim(message) && !hasEvidence(message)) {
    return resultSystemMessage('Subagent output claims completion without concrete evidence. Treat it as unverified until checked in the parent session.');
  }
  return null;
}

function evaluateStopResult(input) {
  const message = input.last_assistant_message || '';
  if (hasCompletionClaim(message) && !hasEvidence(message)) {
    return resultSystemMessage('The response appears to claim completion without concrete evidence. Re-check files or commands before relying on it.');
  }
  return null;
}

function evaluateLifecycleResult(input) {
  const eventName = input.hook_event_name || '';
  if (eventName === 'SessionStart') {
    return resultAdditionalContext('SessionStart', 'For resumed or context-sensitive work, prefer /goldband-context-restore before editing.');
  }
  if (eventName === 'PreCompact') {
    return resultAdditionalContext('PreCompact', 'Preserve goal, verification state, and blockers in the compact summary.');
  }
  if (eventName === 'PostCompact') {
    return resultAdditionalContext('PostCompact', 'Re-check current files before making completion claims after compaction.');
  }
  if (eventName === 'Stop') {
    return evaluateStopResult(input);
  }

  return null;
}

function evaluateUserPromptSubmitResult(input) {
  const prompt = input.prompt || '';
  if (/\/goldband-|\/plan\b/.test(prompt)) {
    return null;
  }

  const messages = WORKFLOW_HINTS
    .filter(hint => hint.pattern.test(prompt))
    .map(hint => hint.message);

  if (messages.length === 0) return null;
  return resultAdditionalContext('UserPromptSubmit', messages.join(' '));
}

function evaluatePreToolUseResult(input) {
  const reason = findHighRiskToolUse(input);
  if (reason) {
    return resultPreToolUseDeny(reason);
  }

  const command = input.tool_input?.command || '';
  const toolName = input.tool_name || '';
  const contexts = [];
  if (toolName === 'Bash' && shouldWarnDevServer(command)) {
    contexts.push('Dev server commands are allowed, but prefer a persistent terminal or tmux so logs remain available.');
  }

  if (toolName === 'apply_patch') {
    const secretWarning = secretWarningForPatch(command);
    if (secretWarning) contexts.push(secretWarning);
  }

  if (isProbablyMutatingMcp(toolName)) {
    contexts.push('This MCP tool name looks mutating. Verify authorization and expected side effects before proceeding.');
  }

  if (contexts.length === 0) return null;
  return resultAdditionalContext('PreToolUse', contexts.join(' '));
}

function evaluatePermissionRequestResult(input) {
  const reason = findHighRiskToolUse(input);
  if (reason) {
    return resultPermissionRequestDeny(reason);
  }
  return null;
}

function evaluateInput(input) {
  const eventName = input.hook_event_name || '';

  if (eventName === 'UserPromptSubmit') return evaluateUserPromptSubmitResult(input);
  if (eventName === 'PreToolUse') return evaluatePreToolUseResult(input);
  if (eventName === 'PermissionRequest') return evaluatePermissionRequestResult(input);
  if (eventName === 'PostToolUse') return evaluatePostToolUseResult(input);
  if (eventName === 'SubagentStop') return evaluateSubagentStopResult(input);
  return evaluateLifecycleResult(input);
}

function tokenizeCommand(command) {
  return String(command || '').match(/"[^"]*"|'[^']*'|[^\s]+/g) || [];
}

function stripQuotes(value) {
  return String(value || '').replace(/^["']|["']$/g, '');
}

function isRiskyRmTarget(value) {
  const target = stripQuotes(value);
  const riskyExact = new Set([
    '/',
    '/*',
    '~',
    '~/',
    '$HOME',
    '$HOME/',
    '.',
    '..',
    '*',
    '/Users',
    '/System',
    '/Library',
    '/private',
    '/etc',
    '/var',
    '/usr',
    '/bin',
    '/sbin',
    '/Applications'
  ]);
  if (riskyExact.has(target)) return true;
  if (/^(?:\.{1,2}|~|\$HOME)?\/?\*$/.test(target)) return true;
  if (/^(?:\.|~|\$HOME)\//.test(target)) return true;
  if (/^\/(?:Users|System|Library|private|etc|var|usr|bin|sbin|Applications)(?:\/|$)/.test(target)) return true;
  return false;
}

function isRecursiveForceRm(tokens, index) {
  let hasRecursive = false;
  let hasForce = false;
  const targets = [];

  for (let i = index + 1; i < tokens.length; i += 1) {
    const token = stripQuotes(tokens[i]);
    if (!token || token === '--') continue;
    if (token.startsWith('-')) {
      hasRecursive = hasRecursive || /r/i.test(token);
      hasForce = hasForce || /f/i.test(token);
      continue;
    }

    targets.push(token);
  }

  return hasRecursive && hasForce && targets.some(isRiskyRmTarget);
}

function findGitCleanCommand(tokens) {
  for (let i = 0; i < tokens.length - 1; i += 1) {
    if (stripQuotes(tokens[i]) === 'git' && stripQuotes(tokens[i + 1]) === 'clean') {
      return i;
    }
  }
  return -1;
}

function isDestructiveGitClean(tokens, index) {
  let hasForce = false;
  let hasDryRun = false;

  for (let i = index + 2; i < tokens.length; i += 1) {
    const token = stripQuotes(tokens[i]);
    if (token === '--') break;
    if (!token.startsWith('-')) continue;

    if (token === '-n' || token === '--dry-run') hasDryRun = true;
    if (token === '-f' || token === '--force' || /^-[A-Za-z]*f[A-Za-z]*$/.test(token)) hasForce = true;
  }

  return hasForce && !hasDryRun;
}

function findHighRiskBash(command) {
  const normalized = String(command || '').replace(/\s+/g, ' ').trim();
  const tokens = tokenizeCommand(command);

  for (let i = 0; i < tokens.length; i += 1) {
    if (stripQuotes(tokens[i]) === 'rm' && isRecursiveForceRm(tokens, i)) {
      return 'Recursive force deletion targets a root, home, current directory, wildcard, or system path.';
    }
  }

  const gitCleanIndex = findGitCleanCommand(tokens);
  if (gitCleanIndex >= 0 && isDestructiveGitClean(tokens, gitCleanIndex)) {
    return 'Destructive git clean over untracked files or directories is high-risk.';
  }

  const rules = [
    {
      pattern: /^\s*sudo\b/,
      reason: 'sudo commands are high-risk and require explicit user approval outside the hook path.'
    },
    {
      pattern: /\b(?:curl|wget)\b[\s\S]*\|\s*(?:sh|bash|zsh|fish)\b/,
      reason: 'Piping downloaded code directly into a shell is high-risk.'
    },
    {
      pattern: /\bdd\b[\s\S]*\bof=\/dev\//,
      reason: 'Writing raw data to a device path is high-risk.'
    },
    {
      pattern: /\b(?:mkfs|fdisk|gparted)\b|\bdiskutil\s+(?:erase|partition|apfs\s+delete)/i,
      reason: 'Disk formatting or partition commands are high-risk.'
    },
    {
      pattern: /\bgit\s+reset\s+--hard\b|\bgit\s+push\b[^\n]*--force(?:-with-lease)?\b/,
      reason: 'Destructive git history or untracked-file operations are high-risk.'
    },
    {
      pattern: /\bchmod\s+-R\s+777\s+(?:\/|~|\$HOME|\.|\*)\b|\bchown\s+-R\b[\s\S]*\s(?:\/|~|\$HOME|\.|\*)\b/,
      reason: 'Recursive permission or ownership changes over broad targets are high-risk.'
    },
    {
      pattern: /\b(?:cat|less|more|sed|awk)\b[\s\S]*(?:~\/\.ssh\/id_|~\/\.aws\/credentials|~\/\.netrc|~\/\.npmrc|~\/\.pypirc|~\/\.kube\/config)/,
      reason: 'Reading credential files into the session is high-risk.'
    },
    {
      pattern: /^\s*(?:env|printenv)\s*$/,
      reason: 'Dumping the full environment can expose secrets.'
    },
    {
      pattern: /\bsecurity\s+find-(?:generic|internet)-password\b/,
      reason: 'Reading passwords from the system keychain is high-risk.'
    }
  ];

  const match = rules.find(rule => rule.pattern.test(normalized));
  return match ? match.reason : null;
}

function findHighRiskPatch(command) {
  const patch = String(command || '');
  if (HIGH_RISK_SECRET_PATTERNS.some(pattern => pattern.test(patch))) {
    return 'Patch content appears to contain a high-confidence secret or private key.';
  }

  if (/^\*\*\* (?:Add|Update|Delete) File: \.git\//m.test(patch)) {
    return 'Patch attempts to modify .git internals.';
  }

  return null;
}

function findHighRiskToolUse(input) {
  const toolName = input.tool_name || '';
  const command = input.tool_input?.command || '';

  if (toolName === 'Bash') {
    return findHighRiskBash(command);
  }

  if (toolName === 'apply_patch') {
    return findHighRiskPatch(command);
  }

  return null;
}

function shouldWarnDevServer(command) {
  return /\b(npm run dev|pnpm( run)? dev|yarn dev|bun run dev)\b/.test(command);
}

function isProbablyMutatingMcp(toolName) {
  return /^mcp__/.test(toolName) && /(?:create|update|delete|remove|write|send|post|deploy|merge|close|resolve)/i.test(toolName);
}

function hasCompletionClaim(message) {
  return /\b(done|complete|completed|fixed|implemented|finished|resolved|all set|verified)\b|已完成|修好|處理好了/i.test(message || '');
}

function hasEvidence(message) {
  const text = String(message || '');
  const evidencePatterns = [
    /\b(?:npm|pnpm|yarn|bun|node|python3?|bash|sh|git|cargo|go|pytest|vitest|jest|tsc|eslint|ruff)\s+[^\n.]+/i,
    /\b(?:passed|failed|exit code|exit status)\b/i,
    /\b\d+\s+(?:passing|passed|failing|failed|tests?)\b/i,
    /\b[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+(?::\d+)?\b/,
    /\b[A-Za-z0-9_.-]+\.(?:js|jsx|ts|tsx|py|md|json|toml|yaml|yml|sh|mjs|cjs)(?::\d+)?\b/,
    /\bgit\s+(?:diff|status|show|log)\b/i,
    /測試\s*(?:通過|失敗)|驗證\s*(?:通過|失敗)|指令[:：]|檔案[:：]|路徑[:：]/
  ];
  return evidencePatterns.some(pattern => pattern.test(text));
}

async function main() {
  const input = parseInput(await readStdinRaw());
  writeResult(evaluateInput(input));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[goldband] Codex hook failed: ${error?.stack || error}`);
    process.exit(1);
  });
}

module.exports = {
  evaluateInput,
  findHighRiskBash,
  findHighRiskPatch,
  hasCompletionClaim,
  hasEvidence
};
