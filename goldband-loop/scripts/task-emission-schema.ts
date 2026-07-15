#!/usr/bin/env bun
/**
 * Executable wire contract for per-review Implementation Tasks JSONL (#1454).
 *
 * This module is both the TypeScript source of truth and the runtime used to
 * serialize, validate, aggregate, and render task emissions. `bun run build`
 * compiles it to `bin/goldband-task-emission` for installed workflows.
 */

import {
  appendFileSync,
  readFileSync,
  readdirSync,
  type Dirent,
} from 'node:fs';
import { join } from 'node:path';

export const TASK_PHASES = [
  'ceo-review',
  'design-review',
  'eng-review',
  'devex-review',
] as const;
export const TASK_PRIORITIES = ['P1', 'P2', 'P3'] as const;

export type TaskPhase = (typeof TASK_PHASES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** One row in tasks-{phase}-{datetime}.jsonl. */
export interface ImplementationTask {
  phase: TaskPhase;
  run_id: string;
  branch: string;
  commit: string;
  id: string;
  priority: TaskPriority;
  component: string;
  files: string[];
  effort_human: string;
  effort_cc: string;
  title: string;
  source_finding: string;
}

const TASK_FIELDS = [
  'phase',
  'run_id',
  'branch',
  'commit',
  'id',
  'priority',
  'component',
  'files',
  'effort_human',
  'effort_cc',
  'title',
  'source_finding',
] as const satisfies readonly (keyof ImplementationTask)[];

const TASK_FIELD_SET = new Set<string>(TASK_FIELDS);
const PHASE_ORDER = new Map<TaskPhase, number>(
  TASK_PHASES.map((phase, index) => [phase, index]),
);
const PRIORITY_ORDER = new Map<TaskPriority, number>(
  TASK_PRIORITIES.map((priority, index) => [priority, index]),
);

export interface AggregateTaskDirectoryOptions {
  tasksDir: string;
  branch: string;
  commits: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(
  value: unknown,
  field: string,
): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

/** Validate an untrusted JSON value and return its typed wire representation. */
export function validateImplementationTask(value: unknown): ImplementationTask {
  if (!isRecord(value)) {
    throw new Error('task must be a JSON object');
  }

  for (const field of TASK_FIELDS) {
    if (!Object.hasOwn(value, field)) {
      throw new Error(`missing required field: ${field}`);
    }
  }
  for (const field of Object.keys(value)) {
    if (!TASK_FIELD_SET.has(field)) {
      throw new Error(`unknown field: ${field}`);
    }
  }

  if (
    typeof value.phase !== 'string' ||
    !TASK_PHASES.includes(value.phase as TaskPhase)
  ) {
    throw new Error(`phase must be one of ${TASK_PHASES.join(', ')}`);
  }
  if (
    typeof value.priority !== 'string' ||
    !TASK_PRIORITIES.includes(value.priority as TaskPriority)
  ) {
    throw new Error(`priority must be one of ${TASK_PRIORITIES.join(', ')}`);
  }

  const id = requireNonEmptyString(value.id, 'id');
  if (!/^T[1-9]\d*$/.test(id)) {
    throw new Error('id must match T1, T2, ...');
  }

  if (!Array.isArray(value.files)) {
    throw new Error('files must be an array');
  }
  const files = value.files.map((file, index) =>
    requireNonEmptyString(file, `files[${index}]`),
  );

  return {
    phase: value.phase as TaskPhase,
    run_id: requireNonEmptyString(value.run_id, 'run_id'),
    branch: requireNonEmptyString(value.branch, 'branch'),
    commit: requireNonEmptyString(value.commit, 'commit'),
    id,
    priority: value.priority as TaskPriority,
    component: requireNonEmptyString(value.component, 'component'),
    files,
    effort_human: requireNonEmptyString(value.effort_human, 'effort_human'),
    effort_cc: requireNonEmptyString(value.effort_cc, 'effort_cc'),
    title: requireNonEmptyString(value.title, 'title'),
    source_finding: requireNonEmptyString(value.source_finding, 'source_finding'),
  };
}

/** Serialize one validated JSONL row without a trailing newline. */
export function serializeImplementationTask(value: unknown): string {
  return JSON.stringify(validateImplementationTask(value));
}

/** Parse and validate every non-empty line from an untrusted JSONL artifact. */
export function parseImplementationTaskJsonl(
  content: string,
  source = '<jsonl>',
): ImplementationTask[] {
  const tasks: ImplementationTask[] = [];
  for (const [index, line] of content.split('\n').entries()) {
    if (line.trim().length === 0) continue;
    const location = `${source}:${index + 1}`;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${location}: invalid JSON: ${message}`);
    }
    try {
      tasks.push(validateImplementationTask(value));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${location}: ${message}`);
    }
  }
  return tasks;
}

/** Dedup key shared by the runtime aggregator and direct API consumers. */
export function dedupKey(
  task: Pick<ImplementationTask, 'component' | 'files' | 'title'>,
): string {
  return JSON.stringify({
    component: task.component,
    files: [...task.files].sort(),
    title: task.title,
  });
}

function compareTaskOrder(a: ImplementationTask, b: ImplementationTask): number {
  return (
    (PRIORITY_ORDER.get(a.priority) ?? Number.MAX_SAFE_INTEGER) -
      (PRIORITY_ORDER.get(b.priority) ?? Number.MAX_SAFE_INTEGER) ||
    (PHASE_ORDER.get(a.phase) ?? Number.MAX_SAFE_INTEGER) -
      (PHASE_ORDER.get(b.phase) ?? Number.MAX_SAFE_INTEGER)
  );
}

/**
 * Validate, scope, reduce to the latest run per phase, and exact-dedupe tasks.
 */
export function aggregateImplementationTasks(
  values: readonly unknown[],
  branch: string,
  commits: readonly string[],
): ImplementationTask[] {
  const tasks = values.map((value) => validateImplementationTask(value));
  const commitSet = new Set(commits);
  const scoped = tasks.filter(
    (task) => task.branch === branch && commitSet.has(task.commit),
  );

  const latestByPhase = new Map<TaskPhase, string>();
  for (const task of scoped) {
    const current = latestByPhase.get(task.phase);
    if (current === undefined || task.run_id > current) {
      latestByPhase.set(task.phase, task.run_id);
    }
  }

  const latest = scoped
    .filter((task) => latestByPhase.get(task.phase) === task.run_id)
    .sort(compareTaskOrder);
  const deduped = new Map<string, ImplementationTask>();
  for (const task of latest) {
    const key = dedupKey(task);
    if (!deduped.has(key)) deduped.set(key, task);
  }
  return [...deduped.values()];
}

export function renderAggregatedTasks(tasks: readonly ImplementationTask[]): string {
  if (tasks.length === 0) {
    return '_No actionable tasks emitted from any phase._';
  }
  return tasks
    .map(
      (task) =>
        `- [ ] **${task.id} (${task.priority}, human: ${task.effort_human} / CC: ${task.effort_cc}) — ${task.component}** — ${task.title}\n` +
        `  - Surfaced by: ${task.phase} — ${task.source_finding}\n` +
        `  - Files: ${task.files.join(', ')}`,
    )
    .join('\n');
}

/** Aggregate all per-phase JSONL files in a project task directory. */
export function aggregateTaskDirectory(
  options: AggregateTaskDirectoryOptions,
): string {
  let entries: Dirent<string>[];
  try {
    entries = readdirSync(options.tasksDir, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return `_No per-phase task lists found in ${options.tasksDir} for branch ${options.branch}._`;
    }
    throw error;
  }

  const taskFiles = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        TASK_PHASES.some((phase) =>
          new RegExp(`^tasks-${phase}-.*\\.jsonl$`).test(entry.name),
        ),
    )
    .map((entry) => entry.name)
    .sort();
  if (taskFiles.length === 0) {
    return `_No per-phase task lists found in ${options.tasksDir} for branch ${options.branch}._`;
  }

  const tasks: ImplementationTask[] = [];
  for (const name of taskFiles) {
    const file = join(options.tasksDir, name);
    tasks.push(...parseImplementationTaskJsonl(readFileSync(file, 'utf8'), file));
  }
  return renderAggregatedTasks(
    aggregateImplementationTasks(tasks, options.branch, options.commits),
  );
}

function parseFlags(args: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith('--') || value === undefined) {
      throw new Error(`expected --name value pairs, got: ${args.slice(index).join(' ')}`);
    }
    if (flags.has(flag)) throw new Error(`duplicate option: ${flag}`);
    flags.set(flag, value);
  }
  return flags;
}

function requireFlag(flags: Map<string, string>, name: string): string {
  const value = flags.get(name);
  if (value === undefined) throw new Error(`missing required option: ${name}`);
  return value;
}

function rejectUnknownFlags(flags: Map<string, string>, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  for (const flag of flags.keys()) {
    if (!allowedSet.has(flag)) throw new Error(`unknown option: ${flag}`);
  }
}

function parseFilesJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`--files-json is invalid JSON: ${message}`);
  }
}

function appendCommand(args: string[]): void {
  const flags = parseFlags(args);
  const allowed = [
    '--file',
    '--phase',
    '--run-id',
    '--branch',
    '--commit',
    '--id',
    '--priority',
    '--component',
    '--files-json',
    '--effort-human',
    '--effort-cc',
    '--title',
    '--source-finding',
  ];
  rejectUnknownFlags(flags, allowed);
  const file = requireFlag(flags, '--file');
  const line = serializeImplementationTask({
    phase: requireFlag(flags, '--phase'),
    run_id: requireFlag(flags, '--run-id'),
    branch: requireFlag(flags, '--branch'),
    commit: requireFlag(flags, '--commit'),
    id: requireFlag(flags, '--id'),
    priority: requireFlag(flags, '--priority'),
    component: requireFlag(flags, '--component'),
    files: parseFilesJson(requireFlag(flags, '--files-json')),
    effort_human: requireFlag(flags, '--effort-human'),
    effort_cc: requireFlag(flags, '--effort-cc'),
    title: requireFlag(flags, '--title'),
    source_finding: requireFlag(flags, '--source-finding'),
  });
  appendFileSync(file, `${line}\n`, 'utf8');
}

function aggregateCommand(args: string[]): void {
  const flags = parseFlags(args);
  rejectUnknownFlags(flags, ['--tasks-dir', '--branch', '--commits']);
  const output = aggregateTaskDirectory({
    tasksDir: requireFlag(flags, '--tasks-dir'),
    branch: requireFlag(flags, '--branch'),
    commits: requireFlag(flags, '--commits').split('|').filter(Boolean),
  });
  process.stdout.write(`${output}\n`);
}

function printUsage(): void {
  process.stderr.write(
    'Usage: goldband-task-emission <append|aggregate> [options]\n',
  );
}

export function runTaskEmissionCli(args: string[]): void {
  const [command, ...rest] = args;
  if (command === 'append') {
    appendCommand(rest);
  } else if (command === 'aggregate') {
    aggregateCommand(rest);
  } else {
    printUsage();
    throw new Error(`unknown command: ${command ?? '<missing>'}`);
  }
}

if (import.meta.main) {
  try {
    runTaskEmissionCli(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`goldband-task-emission: ${message}\n`);
    process.exitCode = 1;
  }
}
