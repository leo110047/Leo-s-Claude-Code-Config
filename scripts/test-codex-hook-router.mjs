#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const routerPath = path.join(repoDir, 'codex', 'hooks', 'hook-router.js');
const hooksConfigPath = path.join(repoDir, 'codex', 'hooks.json');

function runHook(input) {
  const result = spawnSync(process.execPath, [routerPath], {
    input: JSON.stringify(input),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');

  const stdout = result.stdout.trim();
  return stdout ? JSON.parse(stdout) : null;
}

function testHighRiskBashDenied() {
  const commands = [
    ['rm -rf /', /Recursive force deletion/],
    ['rm -rf ./*', /Recursive force deletion/],
    ['rm -rf ~/Documents', /Recursive force deletion/],
    ['git clean -fd', /git clean/],
    ['git clean -f -d', /git clean/],
    ['git clean -x -f -d', /git clean/],
    ['git clean -f', /git clean/],
  ];

  for (const [command, reasonPattern] of commands) {
    const output = runHook({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command },
    });

    assert.equal(
      output.hookSpecificOutput.hookEventName,
      'PreToolUse',
      command,
    );
    assert.equal(output.hookSpecificOutput.permissionDecision, 'deny', command);
    assert.match(
      output.hookSpecificOutput.permissionDecisionReason,
      reasonPattern,
      command,
    );
  }
}

function testGitCleanDryRunAllowed() {
  const output = runHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'git clean -n -fd' },
  });

  assert.equal(output, null);
}

function testNormalBashAllowedSilently() {
  const output = runHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'npm test' },
  });

  assert.equal(output, null);
}

function testDevServerWarnsWithoutDeny() {
  const output = runHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'npm run dev' },
  });

  assert.equal(output.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(output.hookSpecificOutput.permissionDecision, undefined);
  assert.match(output.hookSpecificOutput.additionalContext, /allowed/);
}

function testPermissionRequestOnlyDeniesHighRisk() {
  const safeOutput = runHook({
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: { command: 'git status' },
  });
  assert.equal(safeOutput, null);

  const riskyOutput = runHook({
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: { command: 'git reset --hard HEAD' },
  });
  assert.equal(
    riskyOutput.hookSpecificOutput.hookEventName,
    'PermissionRequest',
  );
  assert.equal(riskyOutput.hookSpecificOutput.decision.behavior, 'deny');
}

function testPatchSecretDenied() {
  const fakeToken = 'github_pat_' + 'a'.repeat(64);
  const output = runHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      command: [
        '*** Begin Patch',
        '*** Add File: leaked.txt',
        `+${fakeToken}`,
        '*** End Patch',
      ].join('\n'),
    },
  });

  assert.equal(output.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(output.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(output.hookSpecificOutput.permissionDecisionReason, /secret/);
}

function testPatchAdvisorySecretWarnsOnly() {
  const output = runHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      command: [
        '*** Begin Patch',
        '*** Add File: fixtures/openai-example.txt',
        '+sk-proj-abcdefghijklmnopqrstuvwxyz1234567890',
        '*** End Patch',
      ].join('\n'),
    },
  });

  assert.equal(output.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(output.hookSpecificOutput.permissionDecision, undefined);
  assert.match(
    output.hookSpecificOutput.additionalContext,
    /credential-shaped/,
  );
}

function testGitPatchDenied() {
  const output = runHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      command: [
        '*** Begin Patch',
        '*** Add File: .git/config',
        '+[core]',
        '*** End Patch',
      ].join('\n'),
    },
  });

  assert.equal(output.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(output.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(output.hookSpecificOutput.permissionDecisionReason, /\.git/);
}

function testPostToolUseFailureContext() {
  const output = runHook({
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_response: { exit_code: 1 },
  });

  assert.equal(output.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(
    output.hookSpecificOutput.additionalContext,
    /systematic debugging/,
  );
}

function testPostToolUseStyleGateAdvisory() {
  const fixtureDir = fs.mkdtempSync(path.join(repoDir, '.tmp-style-gate-'));
  const fixtureFile = path.join(fixtureDir, 'fixture.ts');
  const relativeFixture = path.relative(repoDir, fixtureFile);
  try {
    fs.writeFileSync(fixtureFile, 'console.log("debug");\n', 'utf8');
    const output = runHook({
      hook_event_name: 'PostToolUse',
      tool_name: 'apply_patch',
      tool_input: {
        command: [
          '*** Begin Patch',
          `*** Update File: ${relativeFixture}`,
          '@@',
          '+con' + 'sole.log("debug");',
          '*** End Patch',
        ].join('\n'),
      },
    });

    assert.equal(output.hookSpecificOutput.hookEventName, 'PostToolUse');
    assert.match(
      output.hookSpecificOutput.additionalContext,
      /goldband style gate advisory/,
    );
    assert.match(output.hookSpecificOutput.additionalContext, /console-log/);
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
}

function testLifecycleContexts() {
  const output = runHook({ hook_event_name: 'SessionStart' });
  assert.equal(output.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(output.hookSpecificOutput.additionalContext, /context-restore/);
}

function testCompactHooksAreNotRegistered() {
  const hooksConfig = JSON.parse(fs.readFileSync(hooksConfigPath, 'utf8'));
  assert.equal(hooksConfig.hooks.PreCompact, undefined);
  assert.equal(hooksConfig.hooks.PostCompact, undefined);
  assert.equal(runHook({ hook_event_name: 'PreCompact' }), null);
  assert.equal(runHook({ hook_event_name: 'PostCompact' }), null);
}

function testMutatingMcpWarnsOnly() {
  const output = runHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'mcp__github__create_issue',
    tool_input: { title: 'test' },
  });

  assert.equal(output.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(output.hookSpecificOutput.permissionDecision, undefined);
  assert.match(output.hookSpecificOutput.additionalContext, /mutating/);
}

function testPromptWorkflowHint() {
  const output = runHook({
    hook_event_name: 'UserPromptSubmit',
    prompt: 'please review this diff and debug the failing test',
  });

  assert.equal(output.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(output.hookSpecificOutput.additionalContext, /goldband-review/);
  assert.match(
    output.hookSpecificOutput.additionalContext,
    /goldband-investigate/,
  );
}

function testSubagentCompletionNeedsEvidence() {
  const unsupportedClaims = [
    'Done, everything is complete.',
    'Done, verified.',
    'Fixed. I checked the file.',
  ];

  for (const lastAssistantMessage of unsupportedClaims) {
    const output = runHook({
      hook_event_name: 'SubagentStop',
      last_assistant_message: lastAssistantMessage,
    });

    assert.match(
      output.systemMessage,
      /without concrete evidence/,
      lastAssistantMessage,
    );
  }

  const supportedOutput = runHook({
    hook_event_name: 'SubagentStop',
    last_assistant_message:
      'Fixed. Verified with node scripts/test-codex-hook-router.mjs and README.md:101.',
  });
  assert.equal(supportedOutput, null);
}

testHighRiskBashDenied();
testGitCleanDryRunAllowed();
testNormalBashAllowedSilently();
testDevServerWarnsWithoutDeny();
testPermissionRequestOnlyDeniesHighRisk();
testPatchSecretDenied();
testPatchAdvisorySecretWarnsOnly();
testGitPatchDenied();
testPostToolUseFailureContext();
testPostToolUseStyleGateAdvisory();
testLifecycleContexts();
testCompactHooksAreNotRegistered();
testMutatingMcpWarnsOnly();
testPromptWorkflowHint();
testSubagentCompletionNeedsEvidence();

console.log('[OK] Codex hook router behavior verified');
