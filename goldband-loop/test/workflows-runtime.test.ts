import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { defineWorkflow } from '../workflows/definition';
import { digest, evidencePath, stateRoot } from '../workflows/evidence';
import { evaluateStopConditions, runWorkflowLoop } from '../workflows/loop';
import {
  CORE_WORKFLOWS,
  getWorkflow,
  integratedWorkflows,
} from '../workflows/registry';
import { findingsSchema, objectSchema } from '../workflows/schema';
import { runWorkflow } from '../workflows/runtime';
import type { EvaluationSignalSnapshot } from '../workflows/types';
import { reviewSignalFromOutput, reviewSteps } from '../workflows/review';
import { qaChecksSchema } from '../workflows/schema';
import {
  MockHostAdapter,
  claudeRunJsonArgs,
  codexRunJsonArgs,
  runProcess,
} from '../workflows/host-adapter';
import {
  REVIEW_SPECIALISTS,
  aggregateReviewFindings,
  runParallelSpecialistReview,
  selectReviewSpecialists,
} from '../workflows/review-engine';

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
      if (workflow.entrypointType === 'compatibility') {
        const output = result.output as Record<string, unknown>;
        expect(output.mode).toBe('compatibility');
        expect(typeof output.sourceTemplate).toBe('string');
        expect(typeof output.legacyPromptDigest).toBe('string');
      }
    }
    expect(integratedWorkflows().map((entry) => entry.name).sort())
      .toEqual([...CORE_WORKFLOWS].sort());
  });

  test('compatibility workflows fail closed in real mode', async () => {
    await expect(runWorkflow(getWorkflow('goldband-investigate'), {
      mode: 'real',
      host: 'codex',
      goldbandHome: tmpHome,
      cwd: ROOT,
    })).rejects.toThrow('compatibility runtime only supports mock mode');
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

  test('loop stops at iteration cap with the right reason', async () => {
    const result = await runWorkflowLoop(signalWorkflow({
      stopConditions: ['target-met', 'iteration-cap'],
      signals: [
        { kind: 'generic', score: 2 },
        { kind: 'generic', score: 1 },
      ],
    }), { goldbandHome: tmpHome });

    expect(result.iterationCount).toBe(2);
    expect(result.stopReason).toBe('iteration-cap');
    expect(result.signalTrail.map((entry) => entry.signal.kind)).toEqual(['generic', 'generic']);
  });

  test('iteration cap is an implicit loop stop condition', async () => {
    const result = await runWorkflowLoop(signalWorkflow({
      stopConditions: ['target-met'],
      signals: [
        { kind: 'generic', score: 2 },
        { kind: 'generic', score: 1 },
      ],
    }), { goldbandHome: tmpHome });

    expect(result.iterationCount).toBe(2);
    expect(result.stopReason).toBe('iteration-cap');
  });

  test('target-met can stop the loop after the first iteration', async () => {
    const result = await runWorkflowLoop(signalWorkflow({
      signals: [{ kind: 'generic', score: 0, targetMet: true }],
    }), { goldbandHome: tmpHome });

    expect(result.iterationCount).toBe(1);
    expect(result.stopReason).toBe('target-met');
  });

  test('loop rejects workflows without signal hooks before writing evidence', () => {
    const result = runCli(['goldband-investigate', '--loop', '--mode', 'mock'], {
      GOLDBAND_HOME: tmpHome,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('does not support --loop');
    expect(existsSync(evidencePath('goldband-investigate', { goldbandHome: tmpHome }))).toBe(false);
  });

  test('same-blocker-repeated is inferred from consecutive signals', () => {
    const decision = evaluateStopConditions(signalWorkflow({
      stopConditions: ['same-blocker-repeated'],
      signals: [],
    }), {
      iteration: 2,
      previousSignal: { kind: 'generic', score: 5, blockerKey: 'missing-config' },
      stopHistory: [],
    }, { kind: 'generic', score: 5, blockerKey: 'missing-config' });

    expect(decision.matched).toBe(true);
    expect(decision.condition).toBe('same-blocker-repeated');
  });

  test('same-blocker-repeated stops a loop without external flags', async () => {
    const result = await runWorkflowLoop(signalWorkflow({
      stopConditions: ['same-blocker-repeated', 'iteration-cap'],
      signals: [
        { kind: 'generic', score: 5, blockerKey: 'missing-config' },
        { kind: 'generic', score: 5, blockerKey: 'missing-config' },
      ],
    }), { goldbandHome: tmpHome });

    expect(result.iterationCount).toBe(2);
    expect(result.stopReason).toBe('same-blocker-repeated');
  });

  test('review same-blocker key ignores summary wording changes', () => {
    const workflow = getWorkflow('goldband-review');
    const previousSignal = reviewSignalFromOutput([{
      file: 'src/example.ts',
      line: 2,
      severity: 'high',
      summary: 'First wording for the defect.',
      evidence: '`+ riskyChange();` is still present.',
    }], workflowContext(workflow), 'verify-findings');
    const currentSignal = reviewSignalFromOutput([{
      file: 'src/example.ts',
      line: 2,
      severity: 'high',
      summary: 'Different wording for the same defect.',
      evidence: '  `+ riskyChange();`   is still present. ',
    }], workflowContext(workflow), 'verify-findings');

    expect(previousSignal?.blockerKey).not.toContain('First wording');
    expect(previousSignal?.blockerKey).toBe(currentSignal?.blockerKey);
    const decision = evaluateStopConditions(workflow, {
      iteration: 2,
      previousSignal,
      stopHistory: [],
    }, currentSignal!);
    expect(decision.condition).toBe('same-blocker-repeated');
    expect(decision.matched).toBe(true);
  });

  test('no-improvement stops when signal score is flat', async () => {
    const result = await runWorkflowLoop(signalWorkflow({
      stopConditions: ['target-met', 'no-improvement', 'iteration-cap'],
      iterationCap: 3,
      signals: [
        { kind: 'generic', score: 1 },
        { kind: 'generic', score: 1 },
      ],
    }), { goldbandHome: tmpHome });

    expect(result.iterationCount).toBe(2);
    expect(result.stopReason).toBe('no-improvement');
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

  test('goldband-review loop converges after previous findings reach zero', async () => {
    const result = await runWorkflowLoop(getWorkflow('goldband-review'), {
      mode: 'mock',
      cwd: ROOT,
      goldbandHome: tmpHome,
      diffFile: 'test/fixtures/workflows/review.diff',
    });

    expect(result.iterationCount).toBe(2);
    expect(result.stopReason).toBe('findings-converged');
    expect(result.signalTrail.map((entry) => signalCount(entry.signal))).toEqual([2, 0]);

    const runEvents = readJsonl('goldband-review').filter((event) => event.runId === result.runId);
    expect(runEvents.some((event) => event.step === 'loop-summary')).toBe(true);
    expect(runEvents.filter((event) => event.step === 'run-review').map((event) => event.iteration))
      .toEqual([1, 2]);
    const secondReview = runEvents.find((event) => event.step === 'run-review' && event.iteration === 2);
    expect(secondReview?.signalSnapshot.findingCount).toBe(0);

    const reportArtifacts = runEvents
      .filter((event) => event.step === 'render-report')
      .map((event) => event.artifacts[0]);
    expect(reportArtifacts).toHaveLength(2);
    expect(reportArtifacts[0]).toContain('iteration-1.md');
    expect(reportArtifacts[1]).toContain('iteration-2.md');
    expect(reportArtifacts[0]).not.toBe(reportArtifacts[1]);
  });

  test('mock review adapter reads exact loop iteration token', async () => {
    const adapter = new MockHostAdapter();
    const result = await adapter.runJson('GOLDBAND_LOOP_ITERATION=12', {});
    const findings = (result.parsed as { findings: unknown[] }).findings;

    expect(findings).toHaveLength(1);
  });

  test('goldband-qa loop reruns only failed checks', async () => {
    const result = await runWorkflowLoop(getWorkflow('goldband-qa'), {
      mode: 'mock',
      cwd: ROOT,
      goldbandHome: tmpHome,
    });

    expect(result.iterationCount).toBe(2);
    expect(result.stopReason).toBe('target-met');
    expect(result.signalTrail.map((entry) => signalCount(entry.signal))).toEqual([1, 0]);

    const events = readJsonl('goldband-qa').filter((event) => event.runId === result.runId);
    const selectEvents = events.filter((event) => event.step === 'select-checks');
    expect(selectEvents).toHaveLength(2);
    expect(selectEvents[0].outputDigest).not.toBe(selectEvents[1].outputDigest);
    const secondChecks = events.find((event) => event.step === 'run-checks' && event.iteration === 2);
    expect(secondChecks?.signalSnapshot.checkCount).toBe(1);
  });

  test('qa schema errors use qa check field labels', () => {
    expect(() => qaChecksSchema.validate([{ label: 'Missing id' }]))
      .toThrow('qa check.id must be a non-empty string');
  });

  test('loop max iterations cannot exceed registry cap', async () => {
    await expect(runWorkflowLoop(getWorkflow('goldband-review'), {
      mode: 'mock',
      cwd: ROOT,
      goldbandHome: tmpHome,
      maxIterations: 3,
      diffFile: 'test/fixtures/workflows/review.diff',
    })).rejects.toThrow('cannot exceed registry cap');
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

    const badSpecialists = runCli(['goldband-review', '--specialists', 'banana']);
    expect(badSpecialists.status).toBe(2);
    expect(badSpecialists.stderr).toContain('invalid --specialists: banana');
  });

  test('CLI warns when max-iterations is provided without loop', () => {
    const result = runCli([
      'goldband-review',
      '--mode',
      'mock',
      '--max-iterations',
      '1',
      '--diff-file',
      'test/fixtures/workflows/review.diff',
    ], { GOLDBAND_HOME: tmpHome });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('--max-iterations is ignored without --loop');
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
      blocking: false,
    }]);
  });

  test('review specialist selection includes host parity for workflow and prompt diffs', () => {
    const selection = selectReviewSpecialists([
      'diff --git a/goldband-loop/workflows/host-adapter.ts b/goldband-loop/workflows/host-adapter.ts',
      '+codex exec --sandbox read-only',
      'diff --git a/goldband-loop/review/SKILL.md.tmpl b/goldband-loop/review/SKILL.md.tmpl',
      '+allowed-tools:',
    ].join('\n'));

    expect(selection.selected).toContain('correctness-contract');
    expect(selection.selected).toContain('testing');
    expect(selection.selected).toContain('maintainability');
    expect(selection.selected).toContain('api-host-parity');
  });

  test('review specialist selection supports explicit all mode', () => {
    const selection = selectReviewSpecialists('+tiny docs change', 'all');
    expect(selection.selected).toEqual([...REVIEW_SPECIALISTS]);
    expect(selection.skipped).toEqual([]);
  });

  test('review aggregation dedupes, merges specialists, downgrades unsupported blockers, and sorts deterministically', () => {
    const result = aggregateReviewFindings([
      {
        file: 'b.ts',
        line: 3,
        severity: 'high',
        category: 'testing',
        summary: 'Missing regression test.',
        failureScenario: 'Old behavior can return the wrong status.',
        evidence: 'diff adds behavior without a failing test',
        recommendation: 'Add a regression test.',
        suggestedVerification: 'Run bun test b.test.ts',
        blocking: true,
        specialist: 'testing',
      },
      {
        file: 'b.ts',
        line: 3,
        severity: 'medium',
        category: 'testing',
        summary: 'Test gap.',
        failureScenario: 'Old behavior can return the wrong status.',
        evidence: 'longer and more specific diff evidence from second specialist',
        recommendation: 'Add focused coverage.',
        suggestedVerification: 'Run bun test b.test.ts',
        blocking: false,
        specialist: 'correctness-contract',
      },
      {
        file: 'a.ts',
        line: 1,
        severity: 'critical',
        category: 'security',
        summary: 'Possible auth issue.',
        failureScenario: 'Admin route may be reachable.',
        recommendation: 'Verify auth guard.',
        suggestedVerification: 'Run auth regression test.',
        blocking: true,
        specialist: 'security',
      },
    ]);

    expect(result.map((finding) => `${finding.severity}:${finding.file}:${finding.category}`)).toEqual([
      'high:b.ts:testing',
      'info:a.ts:security',
    ]);
    expect(result[0].contributingSpecialists).toEqual(['correctness-contract', 'testing']);
    expect(result[0].evidence).toBe('longer and more specific diff evidence from second specialist');
    expect(result[1].blocking).toBe(false);
    expect(result[1].summary).toContain('[unverified critical]');
  });

  test('parallel specialist review uses bounded concurrent dispatch', async () => {
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    const adapter = {
      name: 'mock' as const,
      capabilities: { readOnlyEnforced: true, parallelDispatch: true },
      async runJson() {
        calls += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
        return {
          text: '{"findings":[]}',
          parsed: { findings: [] },
        };
      },
    };
    const findings = await runParallelSpecialistReview(
      {
        runId: 'test-run',
        workflow: getWorkflow('goldband-review'),
        cwd: ROOT,
        artifacts: [],
        options: {},
      },
      adapter,
      [
        '+auth token check',
        '+schema migration',
        '+workflow host-adapter codex prompt',
        '+performance cache query',
      ].join('\n'),
      {},
    );

    expect(calls).toBeGreaterThan(4);
    expect(maxActive).toBeGreaterThan(1);
    expect(maxActive).toBeLessThanOrEqual(4);
    expect(findings.every((finding) => finding.category !== 'host-capability')).toBe(true);
  });

  test('parallel specialist review honors explicit off mode without dispatch', async () => {
    let calls = 0;
    const adapter = {
      name: 'mock' as const,
      capabilities: { readOnlyEnforced: false, parallelDispatch: false },
      async runJson() {
        calls += 1;
        return {
          text: '{"findings":[]}',
          parsed: { findings: [] },
        };
      },
    };
    const findings = await runParallelSpecialistReview(
      {
        runId: 'test-run',
        workflow: getWorkflow('goldband-review'),
        cwd: ROOT,
        artifacts: [],
        options: { specialists: 'off' },
      },
      adapter,
      '+auth token check',
      {},
      'off',
    );

    expect(calls).toBe(0);
    expect(findings).toHaveLength(REVIEW_SPECIALISTS.length);
    expect(findings.every((finding) => finding.category === 'specialist-skipped')).toBe(true);
  });

  test('parallel specialist review reports host capability degradation', async () => {
    const noReadOnly = await runParallelSpecialistReview(
      workflowContext(getWorkflow('goldband-review')),
      {
        name: 'mock' as const,
        capabilities: { readOnlyEnforced: false, parallelDispatch: true },
        async runJson() {
          throw new Error('should not dispatch without read-only enforcement');
        },
      },
      '+auth token check',
      {},
    );
    expect(noReadOnly).toHaveLength(1);
    expect(noReadOnly[0].category).toBe('host-capability');
    expect(noReadOnly[0].evidence).toContain('read-only enforcement unavailable');

    const noParallel = await runParallelSpecialistReview(
      workflowContext(getWorkflow('goldband-review')),
      {
        name: 'mock' as const,
        capabilities: { readOnlyEnforced: true, parallelDispatch: false },
        async runJson() {
          throw new Error('should not dispatch without parallel support');
        },
      },
      '+tiny docs change',
      {},
    );
    expect(noParallel[0].category).toBe('host-capability');
    expect(noParallel[0].evidence).toContain('parallel specialist dispatch unavailable');
    expect(noParallel.some((finding) => finding.category === 'specialist-skipped')).toBe(true);
  });

  test('parallel specialist review turns rejected specialists into blocking findings', async () => {
    const findings = await runParallelSpecialistReview(
      workflowContext(getWorkflow('goldband-review')),
      {
        name: 'mock' as const,
        capabilities: { readOnlyEnforced: true, parallelDispatch: true },
        async runJson() {
          throw new Error('adapter crashed');
        },
      },
      '+workflow host-adapter codex prompt',
      {},
    );
    const failures = findings.filter((finding) => finding.category === 'specialist-runtime');
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.every((finding) => finding.blocking)).toBe(true);
    expect(failures[0].evidence).toContain('adapter crashed');
  });

  test('Codex JSON adapter args enforce read-only sandbox and output schema', () => {
    const args = codexRunJsonArgs('prompt text', '/tmp/schema.json', '/tmp/out.json');
    expect(args).toContain('--sandbox');
    expect(args.slice(args.indexOf('--sandbox'), args.indexOf('--sandbox') + 2)).toEqual([
      '--sandbox',
      'read-only',
    ]);
    expect(args).toContain('--output-schema');
    expect(args).toContain('/tmp/schema.json');
    expect(args).toContain('-o');
    expect(args).toContain('/tmp/out.json');
  });

  test('Claude JSON adapter args deny mutating tools and cap budget', () => {
    const args = claudeRunJsonArgs('prompt text', { type: 'object' });
    expect(args.slice(args.indexOf('--disallowedTools'), args.indexOf('--disallowedTools') + 2)).toEqual([
      '--disallowedTools',
      'Bash,Edit,Write',
    ]);
    expect(args.slice(args.indexOf('--max-budget-usd'), args.indexOf('--max-budget-usd') + 2)).toEqual([
      '--max-budget-usd',
      '0.50',
    ]);
  });

  test('runProcess resolves after killing a process that ignores SIGTERM', async () => {
    const started = Date.now();
    const result = await runProcess(
      process.execPath,
      ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);'],
      20,
      20,
    );
    expect(Date.now() - started).toBeLessThan(2000);
    expect(result.status).toBeNull();
    expect(result.stderr).toContain('timed out after 20ms');
    expect(result.stderr).toContain('killed after failing to exit on SIGTERM');
  });

  test('review findings schema rejects invalid optional field types', () => {
    expect(() => findingsSchema.validate([{
      file: 'src/example.ts',
      severity: 'medium',
      summary: 'Bad blocking type.',
      blocking: 'yes',
    }])).toThrow('optional field must be boolean');
    expect(() => findingsSchema.validate([{
      file: 'src/example.ts',
      severity: 'medium',
      summary: 'Bad specialists type.',
      contributingSpecialists: ['testing', 123],
    }])).toThrow('optional field must be string array');
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

  test('real LLM loop evidence fixture keeps convergence readback shape', () => {
    const file = resolve(ROOT, 'test/fixtures/workflows/real-llm-loop-evidence.jsonl');
    const events = readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    const runIds = new Set(events.map((event) => event.runId));
    const summary = events.find((event) => event.step === 'loop-summary');

    expect(runIds.size).toBe(1);
    expect(summary?.iterationCount).toBe(2);
    expect(summary?.stopReason).toBe('same-blocker-repeated');
    expect(summary?.signalTrail.map((entry: any) => entry.iteration)).toEqual([1, 2]);
    expect(events.filter((event) => event.step === 'run-review').map((event) => event.iteration))
      .toEqual([1, 2]);
  });
});

function runCli(
  args: string[],
  env: Record<string, string | undefined> = {},
): { status: number | null; stderr: string } {
  const result = spawnSync('bun', ['run', 'workflows/run.ts', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
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

function signalWorkflow(input: {
  signals: EvaluationSignalSnapshot[];
  stopConditions?: string[];
  iterationCap?: number;
}) {
  let index = 0;
  return defineWorkflow({
    name: `signal-workflow-${Math.random()}`,
    target: 'Converge on a generic signal.',
    evaluationSignal: 'Generic score.',
    iterationCap: input.iterationCap ?? 2,
    stopConditions: input.stopConditions ?? ['target-met', 'iteration-cap'],
    sourceTemplate: 'README.md',
    entrypointType: 'typed',
    integrationStatus: 'integrated',
    hostSupport: ['claude'],
    riskLevel: 'low',
    evidencePolicy: 'JSONL',
    migrationNotes: 'test',
    nextStep: 'test',
    steps: [{
      name: 'signal',
      kind: 'typed',
      produces: objectSchema,
      run: () => ({ ok: true }),
    }],
    evaluateSignal: () => input.signals[Math.min(index++, input.signals.length - 1)],
    isTargetMet: (signal) => signal.kind === 'generic' && signal.targetMet === true,
  });
}

function signalCount(signal: EvaluationSignalSnapshot): number {
  if (signal.kind === 'review-findings') return signal.findingCount;
  if (signal.kind === 'qa-checks') return signal.failedCount;
  return signal.score;
}

function workflowContext(workflow = getWorkflow('goldband-review')) {
  return {
    runId: 'test-run',
    workflow,
    cwd: ROOT,
    options: {},
    artifacts: [],
  };
}
