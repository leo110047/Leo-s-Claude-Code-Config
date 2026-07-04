import { createRequire } from 'node:module';
import { fromRepo } from './repo.js';
import { jsonToolResult } from './types.js';

const require = createRequire(import.meta.url);
const { evaluatePreToolUse } = require(
  fromRepo('hooks/scripts/lib/hook-router/pretool-policy.js'),
);

export type PolicyCheckInput = {
  command: string;
  toolName?: 'Bash' | 'Write' | 'Edit';
  host?: 'claude';
  filePath?: string;
  content?: string;
  sessionId?: string;
};

export type PolicyCheckPayload = {
  host: 'claude';
  toolName: 'Bash' | 'Write' | 'Edit';
  outcome: 'allow' | 'warn' | 'block';
  decision: string;
  matchedRules: string[];
  logs: string[];
  executed: false;
};

export function runPolicyCheck(input: PolicyCheckInput) {
  const toolName = input.toolName ?? 'Bash';
  const outcome = evaluatePreToolUse({
    hook_event_name: 'PreToolUse',
    session_id: input.sessionId ?? 'goldband-mcp-dry-run',
    tool_name: toolName,
    tool_input: buildToolInput(input, toolName),
  });
  return jsonToolResult(toPolicyPayload(input, toolName, outcome));
}

function buildToolInput(
  input: PolicyCheckInput,
  toolName: PolicyCheckPayload['toolName'],
) {
  if (toolName === 'Bash') return { command: input.command };
  return {
    command: input.command,
    file_path: input.filePath ?? '',
    content: input.content ?? '',
    new_string: input.content ?? '',
  };
}

function toPolicyPayload(
  input: PolicyCheckInput,
  toolName: PolicyCheckPayload['toolName'],
  outcome: { decision?: string; blockedBy?: string | null; logs?: string[] },
): PolicyCheckPayload {
  const logs = Array.isArray(outcome.logs) ? outcome.logs : [];
  return {
    host: input.host ?? 'claude',
    toolName,
    outcome: policyOutcome(outcome.decision, logs),
    decision: outcome.decision ?? 'allow',
    matchedRules: outcome.blockedBy ? [outcome.blockedBy] : [],
    logs,
    executed: false,
  };
}

function policyOutcome(decision: string | undefined, logs: string[]) {
  if (decision === 'block') return 'block';
  return logs.length > 0 ? 'warn' : 'allow';
}
