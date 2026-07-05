const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { getGitModifiedFiles, isGitRepo } = require('../utils');
const { evaluateCrossReviewGate } = require('./cross-review-gate');

const NOTIFICATION_TITLE = 'Claude Code';
const NOTIFICATION_MESSAGES = {
  Stop: '等待下一步指示',
  permission_prompt: '需要你的同意才能繼續',
  elicitation_dialog: '有問題想問你',
};
const SKIP_NOTIFICATION_TYPES = ['auth_success', 'idle_prompt'];

const EXCLUDED_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /\.config\.[jt]s$/,
  /scripts\//,
  /__tests__\//,
  /__mocks__\//,
];

function isTrueFlag(value) {
  const normalized = String(value || '').toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function isMacOS() {
  return os.platform() === 'darwin';
}

function isWindows() {
  return os.platform() === 'win32';
}

function isLinux() {
  return os.platform() === 'linux';
}

function isTerminalFocused() {
  try {
    if (isMacOS()) {
      const script =
        'tell application "System Events" to get name of first application process whose frontmost is true';
      const frontApp = execFileSync('osascript', ['-e', script], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();

      const terminalApps = [
        'Terminal',
        'iTerm2',
        'iTerm',
        'Ghostty',
        'kitty',
        'Alacritty',
        'WezTerm',
        'Hyper',
      ];
      return terminalApps.includes(frontApp);
    }

    if (isWindows()) {
      return false;
    }

    return false;
  } catch {
    return false;
  }
}

function sendNotification(message) {
  try {
    if (isMacOS()) {
      const safeMessage = String(message).replace(/"/g, '\\"');
      const safeTitle = NOTIFICATION_TITLE.replace(/"/g, '\\"');
      const script = `display notification "${safeMessage}" with title "${safeTitle}" sound name "Glass"`;
      execFileSync('osascript', ['-e', script], { stdio: 'ignore' });
      return;
    }

    if (isWindows()) {
      const psScript = [
        "[void] [System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms')",
        '$n = New-Object System.Windows.Forms.NotifyIcon',
        '$n.Icon = [System.Drawing.SystemIcons]::Information',
        `$n.BalloonTipTitle = '${NOTIFICATION_TITLE}'`,
        `$n.BalloonTipText = '${String(message).replace(/'/g, "''")}'`,
        '$n.Visible = $true',
        '$n.ShowBalloonTip(5000)',
      ].join('; ');
      execFileSync('powershell', ['-NoProfile', '-Command', psScript], {
        stdio: 'ignore',
      });
      return;
    }

    if (isLinux()) {
      execFileSync('notify-send', [NOTIFICATION_TITLE, String(message)], {
        stdio: 'ignore',
      });
    }
  } catch {
    // Silent fail
  }
}

function notifyIfNeeded(input) {
  if (isTrueFlag(process.env.HOOK_DISABLE_DESKTOP_NOTIFY)) {
    return;
  }

  const notificationType = input.notification_type;
  if (notificationType && SKIP_NOTIFICATION_TYPES.includes(notificationType)) {
    return;
  }

  if (isTerminalFocused()) {
    return;
  }

  const hookEventName = input.hook_event_name;
  const message =
    NOTIFICATION_MESSAGES[notificationType] ||
    NOTIFICATION_MESSAGES[hookEventName];

  if (!message) {
    return;
  }

  sendNotification(message);
}

function repoRootFromPolicy() {
  return path.resolve(__dirname, '../../../..');
}

function formatStyleGateIssue(issue) {
  const location = issue.file
    ? `${issue.file}${issue.line ? `:${issue.line}` : ''}`
    : 'repo';
  return `[${issue.rule}] ${location}: ${issue.message}`;
}

function getStyleGateWarningsInGitDiff() {
  if (!isGitRepo()) return [];

  const files = getGitModifiedFiles(['\\.tsx?$', '\\.jsx?$'])
    .filter((file) => fs.existsSync(file))
    .filter((file) => !EXCLUDED_PATTERNS.some((pattern) => pattern.test(file)));
  if (files.length === 0) return [];

  const scriptPath = path.join(
    repoRootFromPolicy(),
    'scripts',
    'check-code-style.mjs',
  );
  if (!fs.existsSync(scriptPath)) return [];

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

  if (result.status === 2) {
    return [
      '[Hook] WARNING: style gate advisory could not run',
      result.stderr.trim(),
    ].filter(Boolean);
  }
  if (!result.stdout.trim()) return [];

  try {
    const parsed = JSON.parse(result.stdout);
    const issues = [...(parsed.violations || []), ...(parsed.advisories || [])];
    if (issues.length === 0) return [];
    return [
      '[Hook] WARNING: goldband style gate advisory for modified files',
      ...issues.slice(0, 8).map(formatStyleGateIssue),
      '[Hook] These warnings are advisory here; pre-commit enforces blocking rules.',
    ];
  } catch {
    return ['[Hook] WARNING: style gate advisory returned invalid JSON'];
  }
}

function evaluateStop(input) {
  const crossReviewResult = evaluateCrossReviewGate(input);
  if (crossReviewResult.decision === 'block') {
    notifyIfNeeded(input);
    return crossReviewResult;
  }

  const warnings = getStyleGateWarningsInGitDiff();
  notifyIfNeeded(input);

  return {
    decision: 'allow',
    blockedBy: null,
    logs: warnings,
  };
}

function evaluateNotification(input) {
  notifyIfNeeded(input);

  return {
    decision: 'allow',
    blockedBy: null,
    logs: [],
  };
}

module.exports = {
  evaluateStop,
  evaluateNotification,
};
