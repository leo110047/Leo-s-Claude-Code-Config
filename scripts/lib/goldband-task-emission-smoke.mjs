import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function taskEmissionBinary(home) {
  return path.join(
    home,
    '.claude',
    'skills',
    'goldband',
    'bin',
    'goldband-task-emission',
  );
}

function appendArguments(taskFile) {
  return [
    'append',
    '--file',
    taskFile,
    '--phase',
    'eng-review',
    '--run-id',
    '20260714T010101Z-1',
    '--branch',
    'dev',
    '--commit',
    'abc123',
    '--id',
    'T1',
    '--priority',
    'P1',
    '--component',
    'runtime/tasks',
    '--files-json',
    '["scripts/task-emission-schema.ts"]',
    '--effort-human',
    '1h',
    '--effort-cc',
    '10min',
    '--title',
    'Enforce task emissions',
    '--source-finding',
    'Runtime contract fixture',
  ];
}

function runCli(binary, args, home) {
  return spawnSync(binary, args, {
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
  });
}

export function assertInstalledTaskEmissionCliRuns(home) {
  const binary = taskEmissionBinary(home);
  const tasksDir = path.join(home, '.goldband', 'projects', 'fixture');
  const taskFile = path.join(
    tasksDir,
    'tasks-eng-review-20260714-010101.jsonl',
  );
  fs.mkdirSync(tasksDir, { recursive: true });

  const append = runCli(binary, appendArguments(taskFile), home);
  assert.equal(append.status, 0, append.stderr || append.stdout);

  const aggregate = runCli(
    binary,
    [
      'aggregate',
      '--tasks-dir',
      tasksDir,
      '--branch',
      'dev',
      '--commits',
      'abc123',
    ],
    home,
  );
  assert.equal(aggregate.status, 0, aggregate.stderr || aggregate.stdout);
  assert.match(aggregate.stdout, /Enforce task emissions/);
}
