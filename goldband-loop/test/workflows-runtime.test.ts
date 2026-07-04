import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { defineWorkflow } from '../workflows/definition';
import { digest, evidencePath, stateRoot } from '../workflows/evidence';
import {
  CORE_WORKFLOWS,
  getWorkflow,
  integratedWorkflows,
} from '../workflows/registry';
import { objectSchema } from '../workflows/schema';
import { runWorkflow } from '../workflows/runtime';
import { reviewSteps } from '../workflows/review';

const ROOT = resolve(import.meta.dir, '..');
let tmpHome: string;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'goldband-workflows-'));
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
});

describe('workflow runtime', () => {
  test('core compatibility workflows emit evidence in mock mode', async () => {
    for (const workflow of integratedWorkflows()) {
      const options = workflow.name === 'goldband-review'
        ? { diffFile: 'test/fixtures/workflows/review.diff' }
        : {};
      const result = await runWorkflow(workflow, {
        ...options,
        mode: 'mock',
        cwd: ROOT,
        goldbandHome: tmpHome,
      });
      expect(result.workflow).toBe(workflow.name);
      expect(readJsonl(workflow.name).length).toBeGreaterThan(0);
    }
    expect(integratedWorkflows().map((entry) => entry.name).sort())
      .toEqual([...CORE_WORKFLOWS].sort());
  });

  test('registered-only workflows are not runnable', async () => {
    await expect(runWorkflow(getWorkflow('goldband-benchmark'), {
      goldbandHome: tmpHome,
    })).rejects.toThrow('registered-only');
  });

  test('iteration cap and repeated-blocker stop condition are enforced', async () => {
    await expect(runWorkflow(getWorkflow('goldband-review'), {
      iteration: 3,
      goldbandHome: tmpHome,
    })).rejects.toThrow('iteration cap');

    const result = await runWorkflow(getWorkflow('goldband-investigate'), {
      repeatedBlocker: true,
      goldbandHome: tmpHome,
      cwd: ROOT,
    });
    expect(readJsonl(result.workflow)).toHaveLength(1);
  });

  test('schema validation failures write failed evidence', async () => {
    const workflow = defineWorkflow({
      name: 'schema-fails',
      target: 'Fail when step output is malformed.',
      evaluationSignal: 'Runtime throws explicit schema error.',
      iterationCap: 1,
      stopConditions: ['target-met'],
      sourceTemplate: 'README.md',
      entrypointType: 'typed',
      integrationStatus: 'integrated',
      hostSupport: ['claude'],
      riskLevel: 'low',
      evidencePolicy: 'JSONL',
      migrationNotes: 'test',
      nextStep: 'test',
      steps: [{
        name: 'bad-output',
        kind: 'typed',
        produces: objectSchema,
        run: () => 'not-object',
      }],
    });

    await expect(runWorkflow(workflow, { goldbandHome: tmpHome }))
      .rejects.toThrow('expected object output');
    const event = readJsonl('schema-fails')[0];
    expect(event.status).toBe('failed');
    expect(event.error).toContain('expected object output');
  });

  test('goldband-review typed flow renders validated report', async () => {
    const result = await runWorkflow(getWorkflow('goldband-review'), {
      mode: 'mock',
      cwd: ROOT,
      goldbandHome: tmpHome,
      diffFile: 'test/fixtures/workflows/review.diff',
    });
    expect(String(result.output)).toContain('Mock review finding');
    const events = readJsonl('goldband-review');
    expect(events.map((event) => event.step)).toContain('collect-diff');
    expect(events.map((event) => event.step)).toContain('render-report');
    expect(events.every((event) => event.runId === result.runId)).toBe(true);
  });

  test('CLI rejects real mode without a real host and invalid enums', () => {
    const noHost = runCli(['goldband-review', '--mode', 'real']);
    expect(noHost.status).toBe(2);
    expect(noHost.stderr).toContain('--mode real requires --host claude or --host codex');

    const badMode = runCli(['goldband-review', '--mode', 'banana']);
    expect(badMode.status).toBe(2);
    expect(badMode.stderr).toContain('invalid --mode: banana');

    const badHost = runCli(['goldband-review', '--mode', 'real', '--host', 'mock']);
    expect(badHost.status).toBe(2);
    expect(badHost.stderr).toContain('--mode real requires --host claude or --host codex');
  });

  test('worktree diff includes safe untracked files', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'goldband-workflow-repo-'));
    try {
      spawnSync('git', ['init'], { cwd: repo, encoding: 'utf8' });
      writeFileSync(join(repo, 'tracked.txt'), 'initial\n');
      commitAll(repo, 'initial');
      writeFileSync(join(repo, 'new-file.txt'), 'hello\n');

      const result = await runWorkflow(getWorkflow('goldband-review'), {
        mode: 'mock',
        cwd: repo,
        goldbandHome: tmpHome,
        worktree: true,
      });
      const collect = readJsonl('goldband-review')
        .find((event) => event.runId === result.runId && event.step === 'collect-diff');
      expect(collect?.outputDigest).toBe(digest({
        source: 'git diff HEAD + untracked',
        diff: [
          'diff --git a/new-file.txt b/new-file.txt',
          'new file mode 100644',
          '--- /dev/null',
          '+++ b/new-file.txt',
          '@@ -0,0 +1,2 @@',
          '+hello',
          '+',
        ].join('\n'),
      }));
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test('worktree diff skips secret-like untracked file content', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'goldband-workflow-repo-'));
    try {
      spawnSync('git', ['init'], { cwd: repo, encoding: 'utf8' });
      writeFileSync(join(repo, 'tracked.txt'), 'initial\n');
      commitAll(repo, 'initial');
      writeFileSync(join(repo, 'secret-not-ignored.txt'), 'token=abc123\n');

      const step = reviewSteps.find((item) => item.name === 'collect-diff');
      expect(step).toBeDefined();
      const output = await step!.run({
        runId: 'test-run',
        workflow: getWorkflow('goldband-review'),
        cwd: repo,
        artifacts: [],
        options: { worktree: true },
      });

      const diff = String((output as { diff: string }).diff);
      expect(diff).toContain('skipped untracked file: secret-like content');
      expect(diff).toContain('secret-not-ignored.txt');
      expect(diff).not.toContain('abc123');
      expect(diff).not.toContain('+token=');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test('worktree diff includes staged tracked changes', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'goldband-workflow-repo-'));
    try {
      spawnSync('git', ['init'], { cwd: repo, encoding: 'utf8' });
      writeFileSync(join(repo, 'tracked.txt'), 'initial\n');
      commitAll(repo, 'initial');
      writeFileSync(join(repo, 'tracked.txt'), 'changed\n');
      spawnSync('git', ['add', 'tracked.txt'], { cwd: repo, encoding: 'utf8' });

      const step = reviewSteps.find((item) => item.name === 'collect-diff');
      expect(step).toBeDefined();
      const output = await step!.run({
        runId: 'test-run',
        workflow: getWorkflow('goldband-review'),
        cwd: repo,
        artifacts: [],
        options: { worktree: true },
      });

      const result = output as { source: string; diff: string };
      expect(result.source).toBe('git diff HEAD');
      expect(result.diff).toContain('diff --git a/tracked.txt b/tracked.txt');
      expect(result.diff).toContain('-initial');
      expect(result.diff).toContain('+changed');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test('review prompt template is resolved from the workflow runtime root', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'goldband-workflow-target-'));
    try {
      writeFileSync(join(repo, 'review.diff'), [
        'diff --git a/app.ts b/app.ts',
        '--- a/app.ts',
        '+++ b/app.ts',
        '@@ -1 +1 @@',
        '-old',
        '+new',
      ].join('\n'));

      const result = await runWorkflow(getWorkflow('goldband-review'), {
        mode: 'mock',
        cwd: repo,
        goldbandHome: tmpHome,
        diffFile: 'review.diff',
      });

      expect(String(result.output)).toContain('Mock review finding');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test('high findings without evidence are retained as unverified info', async () => {
    const step = reviewSteps.find((item) => item.name === 'verify-findings');
    expect(step).toBeDefined();
    const result = await step!.run({
      runId: 'test-run',
      workflow: getWorkflow('goldband-review'),
      cwd: ROOT,
      artifacts: [],
      options: {},
      input: [{
        file: 'src/example.ts',
        severity: 'high',
        summary: 'Possibly serious issue.',
      }],
    });
    expect(result).toEqual([{
      file: 'src/example.ts',
      severity: 'info',
      summary: '[unverified high] Possibly serious issue.',
      evidence: 'High-severity finding lacked concrete diff evidence during runtime verification.',
    }]);
  });

  test('workflow evidence state root follows goldband path precedence', () => {
    const oldEnv = {
      GOLDBAND_HOME: process.env.GOLDBAND_HOME,
      GOLDBAND_STATE_DIR: process.env.GOLDBAND_STATE_DIR,
      GOLDBAND_STATE_ROOT: process.env.GOLDBAND_STATE_ROOT,
      CLAUDE_PLUGIN_DATA: process.env.CLAUDE_PLUGIN_DATA,
      CLAUDE_PLUGIN_ROOT: process.env.CLAUDE_PLUGIN_ROOT,
    };
    try {
      delete process.env.GOLDBAND_HOME;
      process.env.GOLDBAND_STATE_DIR = '/tmp/state-dir';
      process.env.GOLDBAND_STATE_ROOT = '/tmp/state-root';
      process.env.CLAUDE_PLUGIN_DATA = '/tmp/plugin-data';
      process.env.CLAUDE_PLUGIN_ROOT = '/tmp/goldband-plugin';
      expect(stateRoot()).toBe('/tmp/state-dir');

      delete process.env.GOLDBAND_STATE_DIR;
      expect(stateRoot()).toBe('/tmp/state-root');

      delete process.env.GOLDBAND_STATE_ROOT;
      expect(stateRoot()).toBe('/tmp/plugin-data');
    } finally {
      restoreEnv(oldEnv);
    }
  });

  test('real LLM evidence fixture keeps JSONL event shape', () => {
    const file = resolve(ROOT, 'test/fixtures/workflows/real-llm-evidence.jsonl');
    const events = readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(events.map((event) => event.step)).toContain('run-review');
    for (const event of events) {
      expect(event.runId).toBe('c31e6249-de5d-4266-a3c0-b5dd7199fe11');
      expect(event.workflow).toBe('goldband-review');
      expect(typeof event.outputDigest).toBe('string');
      expect(['ok', 'failed', 'skipped']).toContain(event.status);
      expect(Array.isArray(event.artifacts)).toBe(true);
    }
  });
});

function runCli(args: string[]): { status: number | null; stderr: string } {
  const result = spawnSync('bun', ['run', 'workflows/run.ts', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return { status: result.status, stderr: result.stderr };
}

function readJsonl(workflow: string): Array<Record<string, any>> {
  const file = evidencePath(workflow, { goldbandHome: tmpHome });
  return readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function restoreEnv(env: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function commitAll(repo: string, message: string): void {
  spawnSync('git', ['add', '.'], { cwd: repo, encoding: 'utf8' });
  const result = spawnSync('git', [
    '-c',
    'user.name=Goldband Test',
    '-c',
    'user.email=goldband-test@example.invalid',
    'commit',
    '-m',
    message,
  ], { cwd: repo, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}
