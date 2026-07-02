import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot, run, ToolError } from './config.mjs';
import { CODE_EXTENSIONS } from './constants.mjs';

export function toRepoRelative(filePath) {
  if (!filePath) return null;
  const absolute = path.isAbsolute(filePath)
    ? path.normalize(filePath)
    : path.resolve(repoRoot, filePath);
  const relative = path.relative(repoRoot, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  return relative.split(path.sep).join('/');
}

export function uniqueFiles(files) {
  return [...new Set(files)].filter((file) => !isIgnoredPath(file));
}

export function listFilesForMode(mode, explicitFiles) {
  if (mode === 'staged') return listStagedFiles();
  if (mode === 'files') {
    return explicitFiles.map(toRepoRelative).filter(Boolean);
  }
  return listRepoFiles();
}

export function fileContent(relativePath, mode) {
  return mode === 'staged'
    ? readStagedFile(relativePath)
    : readWorkingTreeFile(relativePath);
}

export function decodeText(buffer) {
  if (!buffer || isBinary(buffer)) return null;
  return buffer.toString('utf8');
}

export function isBinary(buffer) {
  if (!buffer) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000));
  return sample.includes(0);
}

export function lineCount(text) {
  if (!text) return 0;
  const withoutTrailing = text.endsWith('\n') ? text.slice(0, -1) : text;
  return withoutTrailing ? withoutTrailing.split('\n').length : 0;
}

export function isCodeFile(file) {
  return CODE_EXTENSIONS.has(path.extname(file));
}

function isIgnoredPath(relativePath) {
  return (
    !relativePath ||
    relativePath.startsWith('.git/') ||
    relativePath.startsWith('node_modules/') ||
    relativePath.startsWith('vendor/') ||
    relativePath.startsWith('dist/') ||
    relativePath.startsWith('build/') ||
    relativePath.endsWith('.min.js')
  );
}

function listStagedFiles() {
  const result = run('git', [
    'diff',
    '--cached',
    '--name-only',
    '--diff-filter=ACMR',
    '-z',
  ]);
  if (result.status !== 0) {
    throw new ToolError('failed to list staged files', result.stderr.trim());
  }
  return splitGitPathList(result.stdout);
}

function listRepoFiles() {
  const result = run('git', [
    'ls-files',
    '-z',
    '--cached',
    '--others',
    '--exclude-standard',
  ]);
  if (result.status !== 0) {
    throw new ToolError('failed to list tracked files', result.stderr.trim());
  }
  return splitGitPathList(result.stdout);
}

function splitGitPathList(output) {
  return output.split('\0').filter(Boolean).map(toRepoRelative).filter(Boolean);
}

function readWorkingTreeFile(relativePath) {
  try {
    return fs.readFileSync(path.join(repoRoot, relativePath));
  } catch {
    return null;
  }
}

function readStagedFile(relativePath) {
  const result = spawnSync('git', ['show', `:${relativePath}`], {
    cwd: repoRoot,
    encoding: 'buffer',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) return null;
  return result.stdout;
}
