const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_RETENTION_DAYS = 30;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function parsePositiveInt(value, fallback) {
  const parsed = parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envPath(name) {
  const value = process.env[name];
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function dataRootCandidates() {
  const candidates = [];
  const pluginData = envPath('CLAUDE_PLUGIN_DATA');
  const explicit = envPath('GOLDBAND_DATA_DIR');
  const xdgDataHome = envPath('XDG_DATA_HOME');
  const homeDir = os.homedir();

  if (pluginData) candidates.push(pluginData);
  if (explicit) candidates.push(explicit);
  if (xdgDataHome) candidates.push(path.join(xdgDataHome, 'goldband'));
  if (homeDir) {
    candidates.push(path.join(homeDir, '.local', 'share', 'goldband'));
  }
  candidates.push(path.join(os.tmpdir(), 'goldband'));

  return [...new Set(candidates)];
}

function dataRoot() {
  for (const candidate of dataRootCandidates()) {
    try {
      return ensureDir(candidate);
    } catch {
      // Try the next telemetry data root candidate.
    }
  }

  return path.join(os.tmpdir(), 'goldband');
}

function usageTelemetryEnabled() {
  const flag = String(
    process.env.GOLDBAND_USAGE_TELEMETRY_ENABLED ?? '1',
  ).toLowerCase();
  return flag === '1' || flag === 'true' || flag === 'yes';
}

function usageFile() {
  return (
    process.env.GOLDBAND_USAGE_FILE ||
    path.join(dataRoot(), 'hook-router', 'usage-events.jsonl')
  );
}

function rotateIfOversized(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;

    const maxBytes = parsePositiveInt(
      process.env.GOLDBAND_USAGE_MAX_BYTES,
      DEFAULT_MAX_BYTES,
    );
    const stats = fs.statSync(filePath);
    if (stats.size < maxBytes) return;

    fs.renameSync(filePath, `${filePath}.${Date.now()}`);
  } catch {
    // Telemetry retention must never block hook execution.
  }
}

function cleanupExpiredUsageFiles(filePath) {
  try {
    const retentionDays = parsePositiveInt(
      process.env.GOLDBAND_USAGE_RETENTION_DAYS,
      DEFAULT_RETENTION_DAYS,
    );
    const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
    const nowMs = Date.now();
    const directory = path.dirname(filePath);
    const baseName = path.basename(filePath);
    const prefix = `${baseName}.`;

    for (const entry of fs.readdirSync(directory)) {
      if (!entry.startsWith(prefix)) continue;

      const rotatedPath = path.join(directory, entry);
      try {
        const stats = fs.statSync(rotatedPath);
        if (nowMs - stats.mtimeMs > retentionMs) {
          fs.unlinkSync(rotatedPath);
        }
      } catch {
        // Ignore one-file cleanup failures.
      }
    }
  } catch {
    // Telemetry retention must never block hook execution.
  }
}

function appendUsageEvent(entry) {
  if (!usageTelemetryEnabled() || !entry || typeof entry !== 'object') {
    return;
  }

  const filePath = usageFile();
  const payload = {
    ...entry,
    recordedAt: new Date().toISOString(),
  };

  try {
    ensureDir(path.dirname(filePath));
    rotateIfOversized(filePath);
    cleanupExpiredUsageFiles(filePath);
    fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
  } catch {
    // Telemetry must never block hook execution.
  }
}

function normalizeEntryName(value) {
  const raw = typeof value === 'string' ? value.trim().replace(/^\/+/, '') : '';
  if (!/^goldband-[a-z0-9][a-z0-9-]*$/i.test(raw)) return null;
  return raw.toLowerCase();
}

function sessionId(input) {
  return (
    input.session_id || input.sessionId || process.env.CODEX_SESSION_ID || null
  );
}

function workflowSlashCommands(prompt) {
  const names = new Set();
  const text = String(prompt || '');
  const pattern = /(?:^|[\s([{])\/(goldband-[a-z0-9][a-z0-9-]*)\b/gi;
  let match = pattern.exec(text);
  while (match) {
    const name = normalizeEntryName(match[1]);
    if (name) names.add(name);
    match = pattern.exec(text);
  }
  return [...names];
}

function firstWorkflowCommand(command) {
  for (const segment of shellCommandSegments(command)) {
    const executable = firstExecutableToken(segment);
    const name = normalizeEntryName(executable);
    if (name) return name;
  }
  return null;
}

function shellCommandSegments(command) {
  return String(command || '')
    .trim()
    .split(/(?:&&|\|\||[;|\n])/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function shellTokens(segment) {
  return String(segment || '').match(/"[^"]*"|'[^']*'|[^\s]+/g) || [];
}

function stripTokenQuotes(value) {
  return String(value || '').replace(/^["']|["']$/g, '');
}

function isAssignmentToken(token) {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}

function firstExecutableToken(segment) {
  const tokens = shellTokens(segment).map(stripTokenQuotes);
  let index = 0;
  while (index < tokens.length && isAssignmentToken(tokens[index])) index += 1;

  const prefix = tokens[index];
  if (prefix === 'command' || prefix === 'exec' || prefix === 'time') {
    index += 1;
  } else if (prefix === 'env') {
    index += 1;
    while (index < tokens.length && isAssignmentToken(tokens[index])) {
      index += 1;
    }
  }

  return tokens[index] || '';
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
    .map(normalizeEntryName)
    .filter(Boolean);
}

function workflowEntryEvent(input, options) {
  return {
    category: 'workflow-entry',
    name: options.name,
    action: options.action,
    source: 'codex/hooks/hook-router.js',
    sessionId: sessionId(input),
    confidence: options.confidence,
    host: 'codex',
    detail: {
      trigger: options.trigger,
      hookEventName: input.hook_event_name || null,
      toolName: input.tool_name || null,
    },
  };
}

function skillToolWorkflowEvents(input) {
  if (
    input.hook_event_name !== 'PreToolUse' ||
    !/^Skill$/i.test(input.tool_name || '')
  ) {
    return [];
  }

  return [...new Set(candidateSkillNames(input.tool_input || {}))].map((name) =>
    workflowEntryEvent(input, {
      name,
      action: 'invoked',
      confidence: 'confirmed',
      trigger: 'skill-tool',
    }),
  );
}

function bashWorkflowEvents(input) {
  if (input.hook_event_name !== 'PreToolUse' || input.tool_name !== 'Bash') {
    return [];
  }

  const name = firstWorkflowCommand(input.tool_input?.command || '');
  return name
    ? [
        workflowEntryEvent(input, {
          name,
          action: 'invoked',
          confidence: 'inferred',
          trigger: 'bash-command',
        }),
      ]
    : [];
}

function promptWorkflowEvents(input) {
  if (input.hook_event_name !== 'UserPromptSubmit') return [];
  return workflowSlashCommands(input.prompt || '').map((name) =>
    workflowEntryEvent(input, {
      name,
      action: 'requested',
      confidence: 'inferred',
      trigger: 'slash-command-prompt',
    }),
  );
}

function workflowUsageEvents(input) {
  return [
    ...skillToolWorkflowEvents(input),
    ...bashWorkflowEvents(input),
    ...promptWorkflowEvents(input),
  ];
}

function isDenyResult(result) {
  const output = result?.hookSpecificOutput || {};
  return (
    output.permissionDecision === 'deny' || output.decision?.behavior === 'deny'
  );
}

function denyReason(result) {
  const output = result?.hookSpecificOutput || {};
  return (
    output.permissionDecisionReason ||
    output.decision?.message ||
    result?.systemMessage ||
    ''
  );
}

function structuredTelemetryName(result) {
  const name = result?.hookSpecificOutput?.telemetryName;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

function denyNameFromReason(reason, fallback) {
  const text = String(reason || '');
  if (/Recursive force deletion/i.test(text)) return 'recursive-force-delete';
  if (/git clean/i.test(text)) return 'destructive-git-clean';
  if (/secret|private key/i.test(text)) return 'secret-detector';
  if (/\.git internals/i.test(text)) return 'git-internals';
  if (/sudo commands/i.test(text)) return 'sudo-command';
  if (/downloaded code directly into a shell/i.test(text)) {
    return 'curl-pipe-shell';
  }
  if (/Disk formatting|partition/i.test(text)) return 'disk-formatting';
  if (/Destructive git history/i.test(text)) return 'destructive-git-history';
  if (/credential files/i.test(text)) return 'credential-file-read';
  if (/full environment/i.test(text)) return 'environment-dump';
  if (/keychain/i.test(text)) return 'keychain-read';
  return fallback;
}

function isAdvisoryResult(result) {
  const output = result?.hookSpecificOutput || {};
  return Boolean(result?.systemMessage || output.additionalContext);
}

function hookOutcomeUsageEvents(input, result) {
  if (!result) return [];

  const base = {
    source: 'codex/hooks/hook-router.js',
    sessionId: sessionId(input),
    detail: {
      host: 'codex',
      hookEventName: input.hook_event_name || 'unknown',
      toolName: input.tool_name || null,
    },
  };

  if (isDenyResult(result)) {
    const fallbackName = input.hook_event_name || 'unknown';
    return [
      {
        ...base,
        category: 'hook-decision',
        name:
          structuredTelemetryName(result) ||
          denyNameFromReason(denyReason(result), fallbackName),
        action: 'deny',
      },
    ];
  }

  if (!isAdvisoryResult(result)) return [];

  return [
    {
      ...base,
      category: 'hook-advisory',
      name: input.hook_event_name || 'unknown',
      action: 'emit',
    },
  ];
}

function recordHookTelemetry(input, result) {
  for (const event of [
    ...workflowUsageEvents(input),
    ...hookOutcomeUsageEvents(input, result),
  ]) {
    appendUsageEvent(event);
  }
}

module.exports = {
  appendUsageEvent,
  dataRoot,
  hookOutcomeUsageEvents,
  recordHookTelemetry,
  usageFile,
  workflowUsageEvents,
};
