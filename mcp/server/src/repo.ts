import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = findRepoRoot();

export function fromRepo(...parts: string[]) {
  return path.join(repoRoot, ...parts);
}

function findRepoRoot() {
  const moduleRoot = findGoldbandRoot(moduleDir);
  if (moduleRoot) return moduleRoot;

  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  const gitRoot = result.status === 0 ? result.stdout.trim() : '';
  const checkedGitRoot = gitRoot ? findGoldbandRoot(gitRoot) : null;
  if (checkedGitRoot) return checkedGitRoot;

  throw new Error('Unable to locate goldband repository root for MCP server.');
}

function findGoldbandRoot(startDir: string) {
  let current = path.resolve(startDir);
  while (true) {
    if (hasGoldbandSentinel(current)) return current;

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function hasGoldbandSentinel(candidate: string) {
  return fs.existsSync(
    path.join(candidate, 'hooks/scripts/lib/hook-router/pretool-policy.js'),
  );
}
