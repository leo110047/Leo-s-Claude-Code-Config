const HIGH_RISK_SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bghp_[A-Za-z0-9_]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
];

const HIGH_RISK_BASH_RULES = [
  {
    pattern: /^\s*sudo\b/,
    telemetryName: 'sudo-command',
    reason:
      'sudo commands are high-risk and require explicit user approval outside the hook path.',
  },
  {
    pattern: /\b(?:curl|wget)\b[\s\S]*\|\s*(?:sh|bash|zsh|fish)\b/,
    telemetryName: 'curl-pipe-shell',
    reason: 'Piping downloaded code directly into a shell is high-risk.',
  },
  {
    pattern: /\bdd\b[\s\S]*\bof=\/dev\//,
    telemetryName: 'device-write',
    reason: 'Writing raw data to a device path is high-risk.',
  },
  {
    pattern:
      /\b(?:mkfs|fdisk|gparted)\b|\bdiskutil\s+(?:erase|partition|apfs\s+delete)/i,
    telemetryName: 'disk-formatting',
    reason: 'Disk formatting or partition commands are high-risk.',
  },
  {
    pattern:
      /\bgit\s+reset\s+--hard\b|\bgit\s+push\b[^\n]*--force(?:-with-lease)?\b/,
    telemetryName: 'destructive-git-history',
    reason:
      'Destructive git history or untracked-file operations are high-risk.',
  },
  {
    pattern:
      /\bchmod\s+-R\s+777\s+(?:\/|~|\$HOME|\.|\*)\b|\bchown\s+-R\b[\s\S]*\s(?:\/|~|\$HOME|\.|\*)\b/,
    telemetryName: 'recursive-permission-change',
    reason:
      'Recursive permission or ownership changes over broad targets are high-risk.',
  },
  {
    pattern:
      /\b(?:cat|less|more|sed|awk)\b[\s\S]*(?:~\/\.ssh\/id_|~\/\.aws\/credentials|~\/\.netrc|~\/\.npmrc|~\/\.pypirc|~\/\.kube\/config)/,
    telemetryName: 'credential-file-read',
    reason: 'Reading credential files into the session is high-risk.',
  },
  {
    pattern: /^\s*(?:env|printenv)\s*$/,
    telemetryName: 'environment-dump',
    reason: 'Dumping the full environment can expose secrets.',
  },
  {
    pattern: /\bsecurity\s+find-(?:generic|internet)-password\b/,
    telemetryName: 'keychain-read',
    reason: 'Reading passwords from the system keychain is high-risk.',
  },
];

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
    '/Applications',
  ]);

  if (riskyExact.has(target)) return true;
  if (/^(?:\.{1,2}|~|\$HOME)?\/?\*$/.test(target)) return true;
  if (/^(?:\.|~|\$HOME)\//.test(target)) return true;
  return /^\/(?:Users|System|Library|private|etc|var|usr|bin|sbin|Applications)(?:\/|$)/.test(
    target,
  );
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
    if (
      stripQuotes(tokens[i]) === 'git' &&
      stripQuotes(tokens[i + 1]) === 'clean'
    ) {
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
    if (
      token === '-f' ||
      token === '--force' ||
      /^-[A-Za-z]*f[A-Za-z]*$/.test(token)
    ) {
      hasForce = true;
    }
  }

  return hasForce && !hasDryRun;
}

function highRiskDecision(reason, telemetryName) {
  return { reason, telemetryName };
}

function classifyHighRiskBash(command) {
  const normalized = String(command || '')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = tokenizeCommand(command);

  for (let i = 0; i < tokens.length; i += 1) {
    if (stripQuotes(tokens[i]) === 'rm' && isRecursiveForceRm(tokens, i)) {
      return highRiskDecision(
        'Recursive force deletion targets a root, home, current directory, wildcard, or system path.',
        'recursive-force-delete',
      );
    }
  }

  const gitCleanIndex = findGitCleanCommand(tokens);
  if (gitCleanIndex >= 0 && isDestructiveGitClean(tokens, gitCleanIndex)) {
    return highRiskDecision(
      'Destructive git clean over untracked files or directories is high-risk.',
      'destructive-git-clean',
    );
  }

  const match = HIGH_RISK_BASH_RULES.find((rule) =>
    rule.pattern.test(normalized),
  );
  return match ? highRiskDecision(match.reason, match.telemetryName) : null;
}

function findHighRiskBash(command) {
  return classifyHighRiskBash(command)?.reason || null;
}

function classifyHighRiskPatch(command) {
  const patch = String(command || '');
  if (HIGH_RISK_SECRET_PATTERNS.some((pattern) => pattern.test(patch))) {
    return highRiskDecision(
      'Patch content appears to contain a high-confidence secret or private key.',
      'secret-detector',
    );
  }

  if (/^\*\*\* (?:Add|Update|Delete) File: \.git\//m.test(patch)) {
    return highRiskDecision(
      'Patch attempts to modify .git internals.',
      'git-internals',
    );
  }

  return null;
}

function findHighRiskPatch(command) {
  return classifyHighRiskPatch(command)?.reason || null;
}

function classifyHighRiskToolUse(input) {
  const toolName = input.tool_name || '';
  const command = input.tool_input?.command || '';

  if (toolName === 'Bash') return classifyHighRiskBash(command);
  if (toolName === 'apply_patch') return classifyHighRiskPatch(command);
  return null;
}

module.exports = {
  classifyHighRiskToolUse,
  findHighRiskBash,
  findHighRiskPatch,
};
