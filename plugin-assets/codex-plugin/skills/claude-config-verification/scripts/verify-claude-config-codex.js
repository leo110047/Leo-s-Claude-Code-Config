const path = require('path');
const { spawnSync } = require('child_process');

function isCodexAvailable() {
  const result = spawnSync('codex', ['--version'], {
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
  });

  return !result.error;
}

function parseCodexExecpolicyOutput(rawOutput) {
  const trimmed = (rawOutput || '').trim();
  const jsonStart = trimmed.indexOf('{');
  if (jsonStart === -1) {
    throw new Error('missing JSON payload');
  }

  return JSON.parse(trimmed.slice(jsonStart));
}

function runCodexExecpolicyCheck(rootDir, args) {
  const rulePath = path.join(rootDir, 'codex', 'rules', 'default.rules');
  const result = spawnSync(
    'codex',
    [
      'execpolicy',
      'check',
      '--rules',
      rulePath,
      '--pretty',
      '--',
      ...args.command,
    ],
    {
      cwd: rootDir,
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
    },
  );

  if (result.error) {
    return {
      label: args.label,
      ok: false,
      message: result.error.message,
    };
  }

  if (result.status !== 0) {
    return {
      label: args.label,
      ok: false,
      message: (
        result.stderr ||
        result.stdout ||
        'execpolicy check failed'
      ).trim(),
    };
  }

  try {
    const parsed = parseCodexExecpolicyOutput(result.stdout || '');
    const actualDecision = parsed.decision;
    if (actualDecision !== args.expectedDecision) {
      return {
        label: args.label,
        ok: false,
        message: `expected ${args.expectedDecision}, got ${actualDecision || 'unknown'}`,
      };
    }

    return {
      label: args.label,
      ok: true,
      message: actualDecision,
    };
  } catch (error) {
    return {
      label: args.label,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

module.exports = { isCodexAvailable, runCodexExecpolicyCheck };
