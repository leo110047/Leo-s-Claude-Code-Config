#!/usr/bin/env node

const MAX_STDIN_BYTES = 1024 * 1024;
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  classifyHighRiskToolUse,
  findHighRiskBash,
  findHighRiskPatch,
} = require('./high-risk-policy');
const { dataRoot, recordHookTelemetry } = require('./telemetry');
const {
  armFromPrompt,
  evaluateCrossReviewGate,
} = require('../../hooks/scripts/lib/hook-router/cross-review-gate');

const ADVISORY_SECRET_PATTERNS = [
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/,
  /(?:api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token)\s*[=:]\s*['"][A-Za-z0-9_-]{20,}['"]/i,
];
const DEFAULT_DEDUPE_RETENTION_DAYS = 30;
const CODEX_STOP_BLOCK_EXIT_CODE = 2;

const WORKFLOW_HINTS = [
  {
    name: 'review',
    pattern: /\b(code\s*review|review|pr\s*review)\b|審查|檢查/i,
    message:
      'For full code review, prefer /goldband-review. Use bounded reviewer agents only as a second pass.',
  },
  {
    name: 'debug',
    pattern:
      /\b(debug|bug|error|failure|failing|failed|root cause|regression)\b|除錯|錯誤|失敗|異常|根因/i,
    message:
      'For bugs or failing commands, capture the exact failure first and prefer /goldband-investigate before fixing.',
  },
  {
    name: 'security',
    pattern:
      /\b(security|secret|token|credential|auth|permission|cve|vulnerability)\b|安全|權限|憑證|密鑰|漏洞/i,
    message:
      'For security-sensitive work, prefer /goldband-cso or the security checklist before changing behavior.',
  },
  {
    name: 'planning',
    pattern:
      /\b(plan|planning|proposal|roadmap|architecture|design)\b|計畫|規劃|拆解|架構/i,
    message:
      'For multi-file or risky planning, prefer /plan and use /goldband-plan-eng-review before implementation.',
  },
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
      additionalContext,
    },
  };
}

function buildSystemMessageOutput(message) {
  return { systemMessage: message };
}

function buildStopBlockOutput(
  message,
  telemetryName = 'cross-review-required',
) {
  return {
    hookSpecificOutput: {
      hookEventName: 'Stop',
      telemetryName,
      decision: {
        behavior: 'deny',
        message,
      },
    },
    codexExitCode: CODEX_STOP_BLOCK_EXIT_CODE,
    stderr: message,
  };
}

function buildPreToolUseDeny(reason, telemetryName = null) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
      telemetryName,
    },
  };
}

function buildPermissionRequestDeny(reason, telemetryName = null) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      telemetryName,
      decision: {
        behavior: 'deny',
        message: reason,
      },
    },
  };
}

function resultAdditionalContext(hookEventName, additionalContext) {
  return buildAdditionalContextOutput(hookEventName, additionalContext);
}

function resultSystemMessage(message) {
  return buildSystemMessageOutput(message);
}

function resultStopBlock(message, telemetryName) {
  return buildStopBlockOutput(message, telemetryName);
}

function resultPreToolUseDeny(decision) {
  return buildPreToolUseDeny(decision.reason, decision.telemetryName);
}

function resultPermissionRequestDeny(decision) {
  return buildPermissionRequestDeny(decision.reason, decision.telemetryName);
}

function sessionId(input) {
  return (
    input.session_id || input.sessionId || process.env.CODEX_SESSION_ID || null
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

  const markerDir = path.join(
    dataRoot(),
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

function writeResult(result) {
  writeJson(result ?? {});
}

function secretWarningForPatch(command) {
  const patch = String(command || '');
  if (ADVISORY_SECRET_PATTERNS.some((pattern) => pattern.test(patch))) {
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
      `${toolName} exited non-zero. Capture the exact failure and follow systematic debugging before fixing.`,
    );
  }

  return null;
}

function buildPostToolUsePatchContext(input) {
  const command = input.tool_input?.command || '';
  if (input.tool_name !== 'apply_patch') return null;

  const files = parseApplyPatchFiles(command);
  if (files.length === 0) return null;

  const message = runStyleGateAdvisory(files);
  if (!message) return null;
  return resultAdditionalContext('PostToolUse', message);
}

function evaluatePostToolUseResult(input) {
  return (
    buildPostToolUseFailureContext(input) || buildPostToolUsePatchContext(input)
  );
}

function parseApplyPatchFiles(command) {
  const files = [];
  for (const line of String(command || '').split(/\r?\n/)) {
    const match = line.match(/^\*\*\* (?:Add|Update) File: (.+)$/);
    if (match) files.push(match[1].trim());
  }
  return [...new Set(files)];
}

function formatStyleGateIssue(issue) {
  const location = issue.file
    ? `${issue.file}${issue.line ? `:${issue.line}` : ''}`
    : 'repo';
  return `[${issue.rule}] ${location}: ${issue.message}`;
}

function runStyleGateAdvisory(files) {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const scriptPath = path.join(repoRoot, 'scripts', 'check-code-style.mjs');
  if (!fs.existsSync(scriptPath)) return null;

  const result = spawnSync(
    process.execPath,
    [scriptPath, '--files', ...files, '--format', 'json'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 5 * 1024 * 1024,
      env: { ...process.env, GOLDBAND_STYLE_GATE_HOST: '1' },
    },
  );

  if (result.error) {
    return `goldband style gate advisory failed: ${result.error.message}`;
  }
  if (result.status === 2) {
    return ['goldband style gate advisory could not run.', result.stderr.trim()]
      .filter(Boolean)
      .join(' ');
  }
  if (!result.stdout.trim()) return null;

  try {
    const parsed = JSON.parse(result.stdout);
    const issues = [...(parsed.violations || []), ...(parsed.advisories || [])];
    if (issues.length === 0) return null;
    return [
      'goldband style gate advisory:',
      ...issues.slice(0, 8).map(formatStyleGateIssue),
      'These warnings are advisory here; pre-commit enforces blocking rules.',
    ].join(' ');
  } catch {
    return 'goldband style gate advisory returned invalid JSON.';
  }
}

function evaluateSubagentStopResult(input) {
  const message = input.last_assistant_message || '';
  if (hasCompletionClaim(message) && !hasEvidence(message)) {
    return resultSystemMessage(
      'Subagent output claims completion without concrete evidence. Treat it as unverified until checked in the parent session.',
    );
  }
  return null;
}

function evaluateStopResult(input) {
  const gateResult = evaluateCrossReviewGate(input);
  if (gateResult.decision === 'block') {
    return resultStopBlock(gateResult.logs.join('\n'), gateResult.blockedBy);
  }

  const message = input.last_assistant_message || '';
  if (hasCompletionClaim(message) && !hasEvidence(message)) {
    return resultSystemMessage(
      'The response appears to claim completion without concrete evidence. Re-check files or commands before relying on it.',
    );
  }
  return null;
}

function evaluateLifecycleResult(input) {
  const eventName = input.hook_event_name || '';
  if (eventName === 'SessionStart') {
    if (!markOnce(input, 'session-start-context-restore-hint')) return null;
    return resultAdditionalContext(
      'SessionStart',
      'For resumed or context-sensitive work, prefer /goldband-context-restore before editing.',
    );
  }
  if (eventName === 'Stop') {
    return evaluateStopResult(input);
  }

  return null;
}

function evaluateUserPromptSubmitResult(input) {
  const prompt = input.prompt || '';
  const crossReviewContract = armCrossReviewIfRequested(input);
  if (/\/goldband-|\/plan\b/.test(prompt)) {
    return crossReviewContract
      ? resultAdditionalContext(
          'UserPromptSubmit',
          formatCrossReviewArmMessage(crossReviewContract),
        )
      : null;
  }

  const messages = WORKFLOW_HINTS.filter((hint) =>
    hint.pattern.test(prompt),
  ).map((hint) => hint.message);

  if (crossReviewContract) {
    messages.unshift(formatCrossReviewArmMessage(crossReviewContract));
  }

  if (messages.length === 0) return null;
  return resultAdditionalContext('UserPromptSubmit', messages.join(' '));
}

function armCrossReviewIfRequested(input) {
  try {
    return armFromPrompt(input, { implementer: 'codex' });
  } catch (error) {
    return {
      reviewer: 'unknown',
      planFile: null,
      error: error && error.message ? error.message : String(error),
    };
  }
}

function formatCrossReviewArmMessage(contract) {
  if (contract.error) {
    return `Cross-review gate was requested but could not be armed: ${contract.error}`;
  }
  return `Cross-review gate armed for this session. Reviewer: ${contract.reviewer}. Plan: ${contract.planFile || 'not bound yet'}.`;
}

function evaluatePreToolUseResult(input) {
  const decision = classifyHighRiskToolUse(input);
  if (decision) {
    return resultPreToolUseDeny(decision);
  }

  const command = input.tool_input?.command || '';
  const toolName = input.tool_name || '';
  const contexts = [];
  if (toolName === 'Bash' && shouldWarnDevServer(command)) {
    contexts.push(
      'Dev server commands are allowed, but prefer a persistent terminal or tmux so logs remain available.',
    );
  }

  if (toolName === 'apply_patch') {
    const secretWarning = secretWarningForPatch(command);
    if (secretWarning) contexts.push(secretWarning);
  }

  if (isProbablyMutatingMcp(toolName)) {
    contexts.push(
      'This MCP tool name looks mutating. Verify authorization and expected side effects before proceeding.',
    );
  }

  if (contexts.length === 0) return null;
  return resultAdditionalContext('PreToolUse', contexts.join(' '));
}

function evaluatePermissionRequestResult(input) {
  const decision = classifyHighRiskToolUse(input);
  if (decision) {
    return resultPermissionRequestDeny(decision);
  }
  return null;
}

function evaluateInput(input) {
  const eventName = input.hook_event_name || '';

  if (eventName === 'UserPromptSubmit')
    return evaluateUserPromptSubmitResult(input);
  if (eventName === 'PreToolUse') return evaluatePreToolUseResult(input);
  if (eventName === 'PermissionRequest')
    return evaluatePermissionRequestResult(input);
  if (eventName === 'PostToolUse') return evaluatePostToolUseResult(input);
  if (eventName === 'SubagentStop') return evaluateSubagentStopResult(input);
  return evaluateLifecycleResult(input);
}

function shouldWarnDevServer(command) {
  return /\b(npm run dev|pnpm( run)? dev|yarn dev|bun run dev)\b/.test(command);
}

function isProbablyMutatingMcp(toolName) {
  return (
    /^mcp__/.test(toolName) &&
    /(?:create|update|delete|remove|write|send|post|deploy|merge|close|resolve)/i.test(
      toolName,
    )
  );
}

function hasCompletionClaim(message) {
  return /\b(done|complete|completed|fixed|implemented|finished|resolved|all set|verified)\b|已完成|修好|處理好了/i.test(
    message || '',
  );
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
    /測試\s*(?:通過|失敗)|驗證\s*(?:通過|失敗)|指令[:：]|檔案[:：]|路徑[:：]/,
  ];
  return evidencePatterns.some((pattern) => pattern.test(text));
}

async function main() {
  const input = parseInput(await readStdinRaw());
  const result = evaluateInput(input);
  recordHookTelemetry(input, result);
  if (result?.codexExitCode) {
    if (result.stderr) console.error(result.stderr);
    process.exit(result.codexExitCode);
  }
  writeResult(result);
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
  hasEvidence,
};
