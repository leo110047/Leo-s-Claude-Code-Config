const os = require('os');
const { execFileSync } = require('child_process');
const { evaluateCrossReviewGate } = require('./cross-review-gate');
const { isModeActive, setModeActive } = require('./mode-state');

const NOTIFICATION_TITLE = 'Claude Code';
const NOTIFICATION_MESSAGES = {
  permission_prompt: '需要你的同意才能繼續',
  elicitation_dialog: '有問題想問你',
};
const SKIP_NOTIFICATION_TYPES = ['auth_success', 'idle_prompt'];
const REVIEW_READ_ONLY_MODE = 'review-read-only';

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

function notificationMessageForInput(input) {
  const notificationType = input.notification_type;
  const hookEventName = input.hook_event_name;
  return (
    NOTIFICATION_MESSAGES[notificationType] ||
    NOTIFICATION_MESSAGES[hookEventName] ||
    null
  );
}

function notifyIfNeeded(input) {
  if (isTrueFlag(process.env.HOOK_DISABLE_DESKTOP_NOTIFY)) {
    return;
  }

  const notificationType = input.notification_type;
  if (notificationType && SKIP_NOTIFICATION_TYPES.includes(notificationType)) {
    return;
  }

  const message = notificationMessageForInput(input);
  if (!message) {
    return;
  }

  if (isTerminalFocused()) {
    return;
  }

  sendNotification(message);
}

function clearReviewReadOnlyMode(input) {
  const sessionId =
    input.session_id || process.env.CLAUDE_SESSION_ID || 'default';
  if (!isModeActive(sessionId, REVIEW_READ_ONLY_MODE)) return;

  setModeActive(sessionId, REVIEW_READ_ONLY_MODE, false, {
    source: 'stop-policy',
    reason: 'review workflow turn ended',
  });
}

function evaluateStop(input) {
  const crossReviewResult = evaluateCrossReviewGate(input);
  if (crossReviewResult.decision === 'block') {
    notifyIfNeeded(input);
    return crossReviewResult;
  }

  clearReviewReadOnlyMode(input);
  notifyIfNeeded(input);

  return {
    decision: 'allow',
    blockedBy: null,
    logs: [],
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
  notificationMessageForInput,
};
