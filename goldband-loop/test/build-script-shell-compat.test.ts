import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'fs';
import * as os from 'node:os';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dir, '..');
const REPO_ROOT = path.resolve(ROOT, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')) as {
  scripts: Record<string, string>;
};
const BUILD_SCRIPT = fs.readFileSync(path.join(ROOT, 'scripts', 'build.sh'), 'utf-8');
const WINDOWS_WORKFLOW = fs.readFileSync(
  path.join(REPO_ROOT, '.github', 'workflows', 'goldband-loop-windows.yml'),
  'utf-8',
);
const TASK_EMISSION_WINDOWS_GUARD =
  'test -f bin/goldband-task-emission.exe || test -f bin/goldband-task-emission || (echo "MISSING: goldband-task-emission" && exit 1)';

// Strip single-quoted strings so JS code emitted as `echo '{ ... }'` doesn't
// trip the shell-brace-group check. Conservative: only `'...'` segments.
function stripSingleQuoted(s: string): string {
  return s.replace(/'[^']*'/g, "''");
}

describe('package.json build scripts — POSIX shell compat (D-1460)', () => {
  // Bun's Windows shell parser doesn't grok bash brace groups `{ cmd; }`.
  // Bun 1.3.x on Windows also rejects subshells when the subshell or the
  // command inside it uses redirection, so redirected commands must be direct.
  test('no bash brace groups in any npm script', () => {
    const offending: { script: string; pattern: string }[] = [];
    for (const [name, body] of Object.entries(PKG.scripts)) {
      const stripped = stripSingleQuoted(body);
      const match = stripped.match(/\{\s+[^}]*;\s*\}/);
      if (match) {
        offending.push({ script: name, pattern: match[0] });
      }
    }
    expect(offending).toEqual([]);
  });

  test('build script has no subshells with redirections', () => {
    const offending: { script: string; pattern: string }[] = [];
    for (const [name, body] of Object.entries({ build: PKG.scripts.build ?? '' })) {
      const matches = [
        ...body.matchAll(/\([^)]*[<>][^)]*\)/g),
        ...body.matchAll(/\([^)]*\)\s*[<>]/g),
      ];
      for (const match of matches) {
        offending.push({ script: name, pattern: match[0] });
      }
    }
    expect(offending).toEqual([]);
  });

  test('build script delegates .version writes to a shell script', () => {
    // Bun rejects `( git ... ) > path/.version`.
    const build = PKG.scripts.build ?? '';
    expect(build).not.toMatch(/>\s*\S+\/\.version/);
    expect(build).toBe('bash scripts/build.sh');
    expect(BUILD_SCRIPT).toContain('bash scripts/write-version-files.sh');
  });

  test('Windows setup E2E verifies the task-emission binary', () => {
    expect(WINDOWS_WORKFLOW).toContain(TASK_EMISSION_WINDOWS_GUARD);
  });

  test('task-emission binary guard fails clearly when both names are missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-windows-bin-'));
    try {
      const result = spawnSync('bash', ['-c', TASK_EMISSION_WINDOWS_GUARD], {
        cwd: dir,
        encoding: 'utf-8',
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('MISSING: goldband-task-emission');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
