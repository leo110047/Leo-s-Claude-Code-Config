import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dir, '..', '..', '..');
const ROUTER_PATH = path.join(ROOT, 'hooks', 'scripts', 'hooks', 'hook-router.js');

function runRouter(input: object, env?: Record<string, string>) {
  const metricDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-router-test-'));
  const metricsFile = path.join(metricDir, 'metrics.jsonl');
  const usageFile = path.join(metricDir, 'usage.jsonl');
  const stateFile = path.join(metricDir, 'context.json');

  const result = spawnSync(process.execPath, [ROUTER_PATH], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: {
      ...process.env,
      HOOK_ROUTER_METRICS_ENABLED: '1',
      HOOK_ROUTER_METRICS_FILE: metricsFile,
      HOOK_ROUTER_CONTEXT_STATE_FILE: stateFile,
      GOLDBAND_USAGE_FILE: usageFile,
      ...env,
    },
  });

  const metrics = fs.existsSync(metricsFile)
    ? fs.readFileSync(metricsFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    : [];

  return {
    ...result,
    stdoutText: result.stdout.trim(),
    stderrText: result.stderr.trim(),
    metrics,
    cleanup() {
      fs.rmSync(metricDir, { recursive: true, force: true });
    },
  };
}

afterEach(() => {
  delete process.env.CONTEXT_WARN_THRESHOLD;
  delete process.env.CONTEXT_CRIT_THRESHOLD;
});

describe('hook-router contract', () => {
  test('PreToolUse blocks ad-hoc doc file creation and records blockedBy', () => {
    const result = runRouter({
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: {
        file_path: 'notes/random.md',
        content: '# temp'
      },
      session_id: 'router-doc-block',
    });

    try {
      expect(result.status).toBe(2);
      expect(result.stderrText).toContain('Unnecessary documentation file creation');
      expect(result.metrics).toHaveLength(1);
      expect(result.metrics[0].phase).toBe('PreToolUse');
      expect(result.metrics[0].decision).toBe('block');
      expect(result.metrics[0].blockedBy).toBe('doc-file-blocker');
    } finally {
      result.cleanup();
    }
  });

  test('PostToolUse emits console and context warnings without blocking', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-router-edit-'));
    const filePath = path.join(tempDir, 'sample.js');
    fs.writeFileSync(filePath, 'console.log("debug");\n');

    const result = runRouter({
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: {
        file_path: filePath,
      },
      session_id: 'router-context-warn',
    }, {
      CONTEXT_WARN_THRESHOLD: '1',
      CONTEXT_CRIT_THRESHOLD: '2',
    });

    try {
      expect(result.status).toBe(0);
      expect(result.stderrText).toContain('console.log found');
      expect(result.stderrText).toContain('ContextMonitor');
      expect(result.metrics).toHaveLength(1);
      expect(result.metrics[0].phase).toBe('PostToolUse');
      expect(result.metrics[0].decision).toBe('allow');
      expect(result.metrics[0].blockedBy).toBeNull();
    } finally {
      result.cleanup();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
