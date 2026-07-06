#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  isCodexAvailable,
  runCodexExecpolicyCheck,
} = require('./verify-claude-config-codex');
const { appendHistory } = require('./verify-claude-config-history');
const { printHuman } = require('./verify-claude-config-output');
const {
  checkHookReferences,
  checkShellLaunchers,
  checkWorkflowInstall,
} = require('./verify-claude-config-runtime');

function resolveHookModule(relativePath) {
  const candidate = path.resolve(
    __dirname,
    '../../../../hooks/scripts/lib/hook-router',
    relativePath,
  );
  if (!fs.existsSync(candidate)) {
    return null;
  }

  try {
    return require(candidate);
  } catch {
    return null;
  }
}

const usageTelemetry = resolveHookModule('usage-telemetry.js');

function parseArgs(argv) {
  return {
    json: argv.includes('--json'),
    routerReplay: argv.includes('--router-replay'),
  };
}

function findFilesRecursive(rootDir, matcher) {
  if (!fs.existsSync(rootDir)) return [];

  const results = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (matcher(fullPath)) {
        results.push(fullPath);
      }
    }
  }

  results.sort();
  return results;
}

function validateJsonFile(rootDir, relativePath) {
  const filePath = path.join(rootDir, relativePath);
  if (!fs.existsSync(filePath)) {
    return { file: relativePath, ok: false, message: 'missing' };
  }

  try {
    JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { file: relativePath, ok: true, message: 'valid' };
  } catch (error) {
    return {
      file: relativePath,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function validateTomlFile(rootDir, relativePath) {
  const filePath = path.join(rootDir, relativePath);
  if (!fs.existsSync(filePath)) {
    return { file: relativePath, ok: false, message: 'missing' };
  }

  const result = spawnSync(
    'python3',
    [
      '-c',
      'import sys, tomllib; tomllib.load(open(sys.argv[1], "rb")); print("OK")',
      filePath,
    ],
    {
      cwd: rootDir,
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
    },
  );

  if (result.error) {
    return {
      file: relativePath,
      ok: false,
      message: result.error.message,
    };
  }

  if (result.status !== 0) {
    return {
      file: relativePath,
      ok: false,
      message: (result.stderr || result.stdout || 'invalid TOML').trim(),
    };
  }

  return { file: relativePath, ok: true, message: 'valid' };
}

function validateRequiredFile(rootDir, relativePath) {
  const filePath = path.join(rootDir, relativePath);
  if (!fs.existsSync(filePath)) {
    return { file: relativePath, ok: false, message: 'missing' };
  }

  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (raw.length === 0) {
    return { file: relativePath, ok: false, message: 'empty' };
  }

  return { file: relativePath, ok: true, message: 'present' };
}

function checkSkillFrontmatter(skillPath) {
  const relativePath = path.relative(process.cwd(), skillPath);
  const raw = fs.readFileSync(skillPath, 'utf8');
  const lines = raw.split('\n');
  const warnings = [];
  const errors = [];

  if (lines[0] !== '---') {
    errors.push('missing YAML frontmatter start');
  }

  const frontmatterEnd = lines.indexOf('---', 1);
  if (frontmatterEnd === -1) {
    errors.push('missing YAML frontmatter end');
  }

  const frontmatterText =
    frontmatterEnd > 0 ? lines.slice(1, frontmatterEnd).join('\n') : '';
  if (!/^name:/m.test(frontmatterText)) {
    errors.push('missing name field');
  }
  if (!/^description:/m.test(frontmatterText)) {
    errors.push('missing description field');
  }
  if (lines.length > 500) {
    warnings.push(`over 500 lines (${lines.length})`);
  }

  return {
    file: relativePath,
    ok: errors.length === 0,
    warnings,
    errors,
    lineCount: lines.length,
  };
}

function checkReferenceLinks(skillPath) {
  const relativePath = path.relative(process.cwd(), skillPath);
  const raw = fs.readFileSync(skillPath, 'utf8');
  const matches = raw.match(/references?\/[a-zA-Z0-9._/-]+\.md/g) || [];
  const uniqueMatches = [...new Set(matches)];
  const missing = uniqueMatches.filter(
    (ref) => !fs.existsSync(path.join(path.dirname(skillPath), ref)),
  );

  return {
    file: relativePath,
    ok: missing.length === 0,
    checked: uniqueMatches.length,
    missing,
  };
}

function runRouterReplay(rootDir) {
  const replayScript = path.join(
    rootDir,
    'hooks',
    'scripts',
    'tools',
    'replay-hook-router.js',
  );
  if (!fs.existsSync(replayScript)) {
    return {
      ok: false,
      message: 'hooks/scripts/tools/replay-hook-router.js missing',
    };
  }

  const result = spawnSync(
    process.execPath,
    [replayScript, '--iterations', '5'],
    {
      cwd: rootDir,
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
    },
  );

  return {
    ok: result.status === 0,
    message: result.status === 0 ? 'pass' : 'fail',
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function buildSummary(rootDir, args) {
  const homeDir = os.homedir();
  const staticChecks = buildStaticChecks(rootDir);
  const skillChecks = buildSkillChecks(rootDir);
  const runtimeChecks = buildRuntimeChecks(rootDir, homeDir, args);
  const codex = buildCodexChecks(rootDir);
  const summaryContext = {
    ...staticChecks,
    ...skillChecks,
    ...runtimeChecks,
    codexRuleChecks: codex.checks,
    additionalWarnings: codex.warnings,
  };
  const errors = buildSummaryErrors(summaryContext);
  const warnings = buildSummaryWarnings(summaryContext);

  return {
    ok: errors.length === 0,
    ...staticChecks,
    hookCheck: runtimeChecks.hookCheck,
    codexRuleChecks: codex.checks,
    workflowInstall: runtimeChecks.workflowInstall,
    shellLaunchers: runtimeChecks.shellLaunchers,
    skillCount: skillChecks.skillFiles.length,
    warnings,
    replay: runtimeChecks.replay,
    errors,
  };
}

function buildStaticChecks(rootDir) {
  return {
    jsonChecks: [
      validateJsonFile(rootDir, path.join('hooks', 'hooks.json')),
      validateJsonFile(
        rootDir,
        path.join('skills', 'global', 'skill-rules.json'),
      ),
      validateJsonFile(rootDir, path.join('.claude-plugin', 'plugin.json')),
    ],
    tomlChecks: [
      validateTomlFile(rootDir, path.join('.codex', 'config.toml')),
      validateTomlFile(rootDir, path.join('codex', 'config.toml')),
    ],
    requiredFileChecks: [
      validateRequiredFile(rootDir, 'AGENTS.md'),
      validateRequiredFile(rootDir, path.join('claude', 'CLAUDE.md')),
      validateRequiredFile(rootDir, path.join('codex', 'AGENTS.md')),
      validateRequiredFile(
        rootDir,
        path.join('codex', 'rules', 'default.rules'),
      ),
    ],
  };
}

function buildSkillChecks(rootDir) {
  const skillFiles = findFilesRecursive(
    path.join(rootDir, 'skills'),
    (filePath) => path.basename(filePath) === 'SKILL.md',
  );
  return {
    skillFiles,
    frontmatterChecks: skillFiles.map(checkSkillFrontmatter),
    referenceChecks: skillFiles.map(checkReferenceLinks),
  };
}

function buildRuntimeChecks(rootDir, homeDir, args) {
  return {
    hookCheck: checkHookReferences(rootDir),
    workflowInstall: checkWorkflowInstall(homeDir),
    shellLaunchers: checkShellLaunchers(homeDir),
    replay: args.routerReplay ? runRouterReplay(rootDir) : null,
  };
}

function buildCodexChecks(rootDir) {
  if (!isCodexAvailable()) {
    return {
      checks: [],
      warnings: ['codex CLI not available; execpolicy checks skipped'],
    };
  }
  return { checks: codexExecpolicyChecks(rootDir), warnings: [] };
}

function codexExecpolicyChecks(rootDir) {
  return [
    runCodexExecpolicyCheck(rootDir, {
      label: 'codex/rules/default.rules: git status --short',
      command: ['git', 'status', '--short'],
      expectedDecision: 'allow',
    }),
    runCodexExecpolicyCheck(rootDir, {
      label: 'codex/rules/default.rules: git push origin main',
      command: ['git', 'push', 'origin', 'main'],
      expectedDecision: 'prompt',
    }),
    runCodexExecpolicyCheck(rootDir, {
      label: 'codex/rules/default.rules: rm README.md',
      command: ['rm', 'README.md'],
      expectedDecision: 'prompt',
    }),
  ];
}

function buildSummaryErrors(context) {
  const errors = [
    ...failedCheckMessages(context.jsonChecks),
    ...failedCheckMessages(context.tomlChecks),
    ...failedCheckMessages(context.requiredFileChecks),
    ...frontmatterErrors(context.frontmatterChecks),
    ...referenceErrors(context.referenceChecks),
    ...context.hookCheck.errors,
    ...workflowErrors(context.workflowInstall),
    ...failedCodexMessages(context.codexRuleChecks),
  ];
  if (!context.shellLaunchers.installed) {
    errors.push(...shellLauncherErrors(context.shellLaunchers));
  }
  if (context.replay && !context.replay.ok) errors.push('router replay failed');
  return errors;
}

function failedCheckMessages(checks) {
  return checks
    .filter((item) => !item.ok)
    .map((item) => `${item.file}: ${item.message}`);
}

function frontmatterErrors(checks) {
  return checks.flatMap((item) =>
    item.errors.map((error) => `${item.file}: ${error}`),
  );
}

function referenceErrors(checks) {
  return checks.flatMap((item) =>
    item.missing.map((ref) => `${item.file}: missing ${ref}`),
  );
}

function workflowErrors(workflowInstall) {
  return [
    ...runtimeMissingErrors(
      'workflow Claude runtime',
      workflowInstall.claudeInstalled,
      workflowInstall.claudeChecks,
    ),
    ...runtimeMissingErrors(
      'workflow Codex runtime',
      workflowInstall.codexInstalled,
      workflowInstall.codexChecks,
    ),
    ...runtimeMissingErrors(
      'workflow state',
      workflowInstall.stateInstalled,
      workflowInstall.stateChecks,
    ),
  ];
}

function runtimeMissingErrors(label, installed, checks) {
  return installed
    ? checks
        .filter((item) => !item.ok)
        .map((item) => `${label}: missing ${item.file}`)
    : [];
}

function failedCodexMessages(checks) {
  return checks
    .filter((item) => !item.ok)
    .map((item) => `${item.label}: ${item.message}`);
}

function shellLauncherErrors(shellLaunchers) {
  return shellLaunchers.checks
    .filter((item) => !item.ok)
    .map((item) => `shell launchers: missing ${item.file}`);
}

function buildSummaryWarnings(context) {
  return [
    ...context.frontmatterChecks.flatMap((item) =>
      item.warnings.map((warning) => `${item.file}: ${warning}`),
    ),
    ...context.additionalWarnings,
    ...context.workflowInstall.warnings,
  ];
}

function main() {
  const args = parseArgs(process.argv);
  const rootDir = process.cwd();
  const summary = buildSummary(rootDir, args);
  appendHistory({
    ok: summary.ok,
    skillCount: summary.skillCount,
    warningCount: summary.warnings.length,
    errorCount: summary.errors.length,
    replayRequested: args.routerReplay,
    replayPassed: summary.replay ? summary.replay.ok : null,
  });
  try {
    usageTelemetry?.appendUsageEvent({
      category: 'skill-script',
      name: 'claude-config-verification',
      action: args.routerReplay ? 'verify-config-with-replay' : 'verify-config',
      sessionId: process.env.CLAUDE_SESSION_ID || null,
      source:
        'skills/global/claude-config-verification/scripts/verify-claude-config.js',
      detail: {
        ok: summary.ok,
        skillCount: summary.skillCount,
        errorCount: summary.errors.length,
        warningCount: summary.warnings.length,
      },
    });
  } catch {
    // Telemetry is best-effort only.
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  } else {
    printHuman(summary);
  }

  process.exit(summary.ok ? 0 : 1);
}

main();
