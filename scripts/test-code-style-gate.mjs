import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = process.cwd();
const checker = path.join(repoRoot, 'scripts', 'check-code-style.mjs');
const preCommitHook = path.join(repoRoot, 'git-hooks', 'pre-commit');
const commitMsgHook = path.join(repoRoot, 'git-hooks', 'commit-msg');

const tests = [
  ['markdown setext heading is not a merge conflict', testMarkdownSetext],
  ['real merge conflict block is blocked', testMergeConflictBlock],
  ['commit-msg accepts scope and breaking marker', testCommitMsgScope],
  ['commit-msg remains opt-in', testCommitMsgOptIn],
  ['pre-commit missing checker fails soft', testPreCommitMissingChecker],
  ['pre-commit missing node fails soft', testPreCommitMissingNode],
];

for (const [name, test] of tests) {
  test();
  console.log(`ok - ${name}`);
}

function testMarkdownSetext() {
  const dir = createRepo();
  fs.writeFileSync(path.join(dir, 'README.md'), 'Title\n=======\n\nbody\n');
  run('git', ['add', 'README.md'], { cwd: dir });

  const result = checkStyle(dir);
  assertEqual(result.status, 0, result.stdout + result.stderr);
}

function testMergeConflictBlock() {
  const dir = createRepo();
  fs.writeFileSync(
    path.join(dir, 'README.md'),
    '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\n',
  );
  run('git', ['add', 'README.md'], { cwd: dir });

  const result = checkStyle(dir);
  assertEqual(result.status, 1, result.stdout + result.stderr);
  assertIncludes(result.stdout, '"rule": "merge-conflict"');
}

function testCommitMsgScope() {
  const dir = createRepo();
  fs.writeFileSync(path.join(dir, '.goldband-git-workflow.json'), '{}\n');
  const scoped = path.join(dir, 'scoped-msg');
  const breaking = path.join(dir, 'breaking-msg');
  fs.writeFileSync(scoped, 'feat(api): add endpoint\n');
  fs.writeFileSync(breaking, 'feat!: change contract\n');

  assertEqual(run('bash', [commitMsgHook, scoped], { cwd: dir }).status, 0);
  assertEqual(run('bash', [commitMsgHook, breaking], { cwd: dir }).status, 0);
}

function testCommitMsgOptIn() {
  const dir = createRepo();
  const message = path.join(dir, 'msg');
  fs.writeFileSync(message, 'bad message\n');

  assertEqual(run('bash', [commitMsgHook, message], { cwd: dir }).status, 0);
  fs.writeFileSync(path.join(dir, '.goldband-git-workflow.json'), '{}\n');
  const blocked = run('bash', [commitMsgHook, message], { cwd: dir });
  assertEqual(blocked.status, 1);
  assertIncludes(
    blocked.stderr,
    'commit message must follow Conventional Commits',
  );
}

function testPreCommitMissingChecker() {
  const dir = createRepo();
  const result = run('bash', [preCommitHook], {
    cwd: dir,
    env: {
      ...process.env,
      GOLDBAND_STYLE_GATE_SCRIPT: path.join(dir, 'missing-checker.mjs'),
    },
  });

  assertEqual(result.status, 0, result.stdout + result.stderr);
  assertIncludes(result.stderr, 'style gate script missing');
}

function testPreCommitMissingNode() {
  const dir = createRepo();
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir);
  fs.symlinkSync(resolveCommand('git'), path.join(binDir, 'git'));
  fs.symlinkSync(resolveCommand('dirname'), path.join(binDir, 'dirname'));

  const result = run('/bin/bash', [preCommitHook], {
    cwd: dir,
    env: {
      ...process.env,
      GOLDBAND_STYLE_GATE_SCRIPT: checker,
      PATH: binDir,
    },
  });

  assertEqual(result.status, 0, result.stdout + result.stderr);
  assertIncludes(result.stderr, 'node not found');
}

function checkStyle(cwd) {
  return run(process.execPath, [checker, '--staged', '--format', 'json'], {
    cwd,
  });
}

function createRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-style-test-'));
  run('git', ['init', '--quiet'], { cwd: dir });
  run('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  run('git', ['config', 'user.name', 'Test User'], { cwd: dir });
  return dir;
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    env: options.env ?? process.env,
  });
}

function resolveCommand(command) {
  const result = run('/bin/sh', ['-c', `command -v ${command}`]);
  assertEqual(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function assertEqual(actual, expected, message = '') {
  if (actual === expected) return;
  throw new Error(`expected ${expected}, got ${actual}\n${message}`);
}

function assertIncludes(value, expected) {
  if (value.includes(expected)) return;
  throw new Error(`expected output to include ${expected}\n${value}`);
}
