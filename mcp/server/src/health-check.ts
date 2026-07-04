import { spawnSync } from 'node:child_process';
import { fromRepo } from './repo.js';
import { jsonToolResult } from './types.js';

type CommandSpec = {
  id: string;
  description: string;
  command: string;
  args: string[];
};

export type CommandRunner = (spec: CommandSpec) => {
  status: number | null;
  stdout: string;
  stderr: string;
};

export type HealthCheckPayload = {
  checks: HealthCheckRow[];
  summary: { passed: number; failed: number };
};

type HealthCheckRow = {
  id: string;
  description: string;
  command: string[];
  status: 'pass' | 'fail';
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

const HEALTH_CHECKS: CommandSpec[] = [
  {
    id: 'json-toml-syntax',
    description: 'Validate tracked JSON and TOML syntax.',
    command: 'python3',
    args: ['scripts/check-json-toml-syntax.py'],
  },
  {
    id: 'hook-script-references',
    description: 'Verify Claude hook script references.',
    command: 'python3',
    args: ['scripts/verify-hook-script-references.py'],
  },
  {
    id: 'goldband-loop-inventory',
    description: 'Verify Goldband Loop source and clean install inventory.',
    command: 'node',
    args: ['scripts/check-goldband-loop-inventory.mjs'],
  },
  {
    id: 'decision-guidance',
    description: 'Verify decision guidance parity.',
    command: 'bash',
    args: ['scripts/verify-decision-guidance.sh'],
  },
];

export function runHealthCheck(runner: CommandRunner = runCommand) {
  const checks: HealthCheckRow[] = HEALTH_CHECKS.map((spec) => {
    const result = runner(spec);
    return {
      id: spec.id,
      description: spec.description,
      command: [spec.command, ...spec.args],
      status: result.status === 0 ? 'pass' : 'fail',
      exitCode: result.status,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    };
  });
  return jsonToolResult({ checks, summary: summarize(checks) });
}

function runCommand(spec: CommandSpec) {
  const result = spawnSync(spec.command, spec.args, {
    cwd: fromRepo(),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? result.error?.message ?? '',
  };
}

function summarize(checks: HealthCheckPayload['checks']) {
  const passed = checks.filter((check) => check.status === 'pass').length;
  return { passed, failed: checks.length - passed };
}
