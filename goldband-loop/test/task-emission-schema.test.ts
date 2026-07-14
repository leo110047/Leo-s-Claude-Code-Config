import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  aggregateTaskDirectory,
  dedupKey,
  serializeImplementationTask,
  validateImplementationTask,
  type ImplementationTask,
} from '../scripts/task-emission-schema';
import {
  generateTasksSectionAggregate,
  generateTasksSectionEmit,
} from '../scripts/resolvers/tasks-section';
import type { TemplateContext } from '../scripts/resolvers/types';

const ROOT = resolve(import.meta.dir, '..');
const SCRIPT = join(ROOT, 'scripts', 'task-emission-schema.ts');
const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'goldband-task-emission.'));
  tempDirs.push(dir);
  return dir;
}

function task(overrides: Partial<ImplementationTask> = {}): ImplementationTask {
  return {
    phase: 'eng-review',
    run_id: '20260714T010101Z-1',
    branch: 'dev',
    commit: 'abc123',
    id: 'T1',
    priority: 'P2',
    component: 'runtime/tasks',
    files: ['scripts/b.ts', 'scripts/a.ts'],
    effort_human: '2h',
    effort_cc: '15min',
    title: 'Enforce task emission contract',
    source_finding: 'The schema had no runtime consumer.',
    ...overrides,
  };
}

const ctx: TemplateContext = {
  skillName: 'plan-eng-review',
  tmplPath: '/tmp/SKILL.md.tmpl',
  host: 'claude',
  paths: {
    skillRoot: '$GOLDBAND_ROOT',
    binDir: '$GOLDBAND_BIN',
    browseDir: '$GOLDBAND_BROWSE',
    designDir: '$GOLDBAND_DESIGN',
    makePdfDir: '$GOLDBAND_MAKE_PDF',
  },
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('task emission wire contract', () => {
  test('serializer validates and emits the canonical JSONL shape', () => {
    const line = serializeImplementationTask(task());
    const parsed = JSON.parse(line);

    expect(parsed).toEqual(task());
    expect(line).not.toContain('\n');
    expect(validateImplementationTask(parsed)).toEqual(task());
    expect(dedupKey(parsed)).toBe(
      JSON.stringify({
        component: 'runtime/tasks',
        files: ['scripts/a.ts', 'scripts/b.ts'],
        title: 'Enforce task emission contract',
      }),
    );
  });

  test('validator rejects malformed required fields and unknown fields', () => {
    expect(() =>
      validateImplementationTask({ ...task(), priority: 'P0' }),
    ).toThrow('priority must be one of P1, P2, P3');
    expect(() =>
      validateImplementationTask({ ...task(), files: ['ok.ts', 42] }),
    ).toThrow('files[1] must be a non-empty string');
    expect(() =>
      validateImplementationTask({ ...task(), extra: true }),
    ).toThrow('unknown field: extra');
  });

  test('aggregator validates every JSONL row, scopes runs, and dedupes by the shared key', () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, 'tasks-eng-review-20260714-010101.jsonl'),
      `${serializeImplementationTask(task({ run_id: '20260714T010101Z-1', title: 'Old task' }))}\n${serializeImplementationTask(task({ run_id: '20260714T010102Z-1' }))}\n`,
    );
    writeFileSync(
      join(dir, 'tasks-devex-review-20260714-010102.jsonl'),
      `${serializeImplementationTask(
        task({
          phase: 'devex-review',
          run_id: '20260714T010103Z-1',
          id: 'T8',
          priority: 'P1',
          files: ['scripts/a.ts', 'scripts/b.ts'],
        }),
      )}\n${serializeImplementationTask(
        task({
          phase: 'devex-review',
          run_id: '20260714T010103Z-1',
          id: 'T9',
          commit: 'stale',
          title: 'Stale task',
        }),
      )}\n`,
    );

    expect(
      aggregateTaskDirectory({
        tasksDir: dir,
        branch: 'dev',
        commits: ['abc123'],
      }),
    ).toBe(
      '- [ ] **T8 (P1, human: 2h / CC: 15min) — runtime/tasks** — Enforce task emission contract\n' +
        '  - Surfaced by: devex-review — The schema had no runtime consumer.\n' +
        '  - Files: scripts/a.ts, scripts/b.ts',
    );
  });

  test('aggregator fails clearly on malformed JSONL instead of silently dropping it', () => {
    const dir = makeTempDir();
    const file = join(dir, 'tasks-eng-review-20260714-010101.jsonl');
    writeFileSync(file, '{"phase":"eng-review"}\n');

    expect(() =>
      aggregateTaskDirectory({
        tasksDir: dir,
        branch: 'dev',
        commits: ['abc123'],
      }),
    ).toThrow(`${file}:1: missing required field: run_id`);
  });
});

describe('task emission runtime CLI', () => {
  test('append serializes and validates before writing', () => {
    const dir = makeTempDir();
    const file = join(dir, 'tasks-eng-review-20260714-010101.jsonl');
    const valid = spawnSync(
      'bun',
      [
        SCRIPT,
        'append',
        '--file', file,
        '--phase', 'eng-review',
        '--run-id', 'run-1',
        '--branch', 'dev',
        '--commit', 'abc123',
        '--id', 'T1',
        '--priority', 'P2',
        '--component', 'runtime/tasks',
        '--files-json', '["scripts/a.ts"]',
        '--effort-human', '2h',
        '--effort-cc', '15min',
        '--title', 'Handle "quotes" safely',
        '--source-finding', 'Line one\nline two',
      ],
      { encoding: 'utf8' },
    );
    expect(valid.status).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(
      `${serializeImplementationTask(
        task({
          run_id: 'run-1',
          files: ['scripts/a.ts'],
          title: 'Handle "quotes" safely',
          source_finding: 'Line one\nline two',
        }),
      )}\n`,
    );

    const invalid = spawnSync(
      'bun',
      [
        SCRIPT,
        'append',
        '--file', file,
        '--phase', 'eng-review',
        '--run-id', 'run-2',
        '--branch', 'dev',
        '--commit', 'abc123',
        '--id', 'T2',
        '--priority', 'P0',
        '--component', 'runtime/tasks',
        '--files-json', '[]',
        '--effort-human', '1h',
        '--effort-cc', '5min',
        '--title', 'Invalid task',
        '--source-finding', 'Invalid priority',
      ],
      { encoding: 'utf8' },
    );
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain(
      'goldband-task-emission: priority must be one of P1, P2, P3',
    );
    expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(1);
  });
});

describe('task section resolver wiring', () => {
  test('emission and aggregation call the shared runtime instead of jq', () => {
    const emit = generateTasksSectionEmit(ctx, ['eng-review']);
    const aggregate = generateTasksSectionAggregate(ctx);

    expect(emit).toContain(
      'TASK_EMISSION_BIN="$GOLDBAND_BIN/goldband-task-emission"',
    );
    expect(emit).toContain('"$TASK_EMISSION_BIN" append');
    expect(aggregate).toContain('"$TASK_EMISSION_BIN" aggregate');
    expect(emit).not.toContain('jq -nc');
    expect(aggregate).not.toContain('jq -s');
  });
});
