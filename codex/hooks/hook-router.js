#!/usr/bin/env node

const MAX_STDIN_BYTES = 1024 * 1024;

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

function blockPreToolUse(reason) {
  writeJson({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason
    }
  });
}

function addContext(hookEventName, additionalContext) {
  writeJson({
    hookSpecificOutput: {
      hookEventName,
      additionalContext
    }
  });
}

function evaluatePreToolUse(input) {
  const command = input.tool_input?.command || '';
  if (/\b(npm run dev|pnpm( run)? dev|yarn dev|bun run dev)\b/.test(command)) {
    blockPreToolUse('Dev servers should run in a persistent terminal or tmux so logs remain available.');
    return;
  }
}

function evaluatePostToolUse(input) {
  const toolName = input.tool_name || 'unknown tool';
  const response = input.tool_response || {};
  const exitCode = response.exit_code ?? response.exitCode;
  if (exitCode && Number(exitCode) !== 0) {
    addContext(
      'PostToolUse',
      `${toolName} exited non-zero. Capture the exact failure and follow systematic debugging before fixing.`
    );
  }
}

function evaluateLifecycle(input) {
  const eventName = input.hook_event_name || '';
  if (eventName === 'SessionStart') {
    addContext('SessionStart', 'For resumed or context-sensitive work, prefer /goldband-context-restore before editing.');
    return;
  }
  if (eventName === 'PreCompact') {
    console.error('[goldband] PreCompact: preserve goal, verification state, and blockers.');
    return;
  }
  if (eventName === 'PostCompact') {
    console.error('[goldband] PostCompact: re-check current files before completion claims.');
    return;
  }
  if (eventName === 'Stop') {
    console.error('[goldband] Stop: verify current evidence before claiming completion.');
  }
}

async function main() {
  const input = parseInput(await readStdinRaw());
  const eventName = input.hook_event_name || '';

  if (eventName === 'PreToolUse') {
    evaluatePreToolUse(input);
    return;
  }
  if (eventName === 'PostToolUse') {
    evaluatePostToolUse(input);
    return;
  }
  evaluateLifecycle(input);
}

main().catch((error) => {
  console.error(`[goldband] Codex hook failed: ${error?.stack || error}`);
  process.exit(1);
});
