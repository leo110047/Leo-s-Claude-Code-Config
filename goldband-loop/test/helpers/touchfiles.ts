/** Small git/glob helpers shared by deterministic browser security tests. */

import { spawnSync } from 'node:child_process';

/** Match `*` within a path segment and `**` across path segments. */
export function matchGlob(file: string, pattern: string): boolean {
  const regex = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*');
  return new RegExp(`^${regex}$`).test(file);
}

/** Return the first local or remote default-branch ref that exists. */
export function detectBaseBranch(cwd: string): string | null {
  for (const ref of ['origin/main', 'origin/master', 'main', 'master']) {
    const result = spawnSync('git', ['rev-parse', '--verify', ref], {
      cwd,
      stdio: 'pipe',
      timeout: 3000,
    });
    if (result.status === 0) return ref;
  }
  return null;
}
