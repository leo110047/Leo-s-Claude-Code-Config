import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ALL_COMMANDS,
  COMMAND_DESCRIPTIONS,
  META_COMMANDS,
  READ_COMMANDS,
  WRITE_COMMANDS,
} from '../browse/src/commands';
import { SNAPSHOT_FLAGS } from '../browse/src/snapshot';

const ROOT = path.resolve(import.meta.dir, '..');

describe('skill command contracts', () => {
  test('command registry sets and descriptions have identical membership', () => {
    const union = new Set([
      ...READ_COMMANDS,
      ...WRITE_COMMANDS,
      ...META_COMMANDS,
    ]);
    expect(ALL_COMMANDS).toEqual(union);
    expect(new Set(Object.keys(COMMAND_DESCRIPTIONS))).toEqual(union);
  });

  test('snapshot metadata only references supported option keys', () => {
    const supported = new Set([
      'interactive',
      'compact',
      'depth',
      'selector',
      'diff',
      'annotate',
      'outputPath',
      'cursorInteractive',
      'heatmap',
    ]);
    for (const flag of SNAPSHOT_FLAGS) {
      expect(supported.has(flag.optionKey), flag.optionKey).toBe(true);
    }
  });

  test('implementation usage shapes match command metadata', () => {
    const implementationFiles = [
      'browse/src/write-commands.ts',
      'browse/src/read-commands.ts',
      'browse/src/meta-commands.ts',
    ];
    const usagePattern =
      /throw new Error\(['"`]Usage:\s*browse\s+(.+?)['"`]\)/g;
    const mismatches: string[] = [];

    for (const relativePath of implementationFiles) {
      const content = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
      for (const match of content.matchAll(usagePattern)) {
        const implementation = match[1].split('\\n')[0].trim();
        const command = implementation.split(/\s/)[0];
        const documented = COMMAND_DESCRIPTIONS[command]?.usage;
        if (documented && usageShape(documented) !== usageShape(implementation)) {
          mismatches.push(`${command}: ${documented} != ${implementation}`);
        }
      }
    }

    expect(mismatches).toEqual([]);
  });
});

describe('shipped skill safety contracts', () => {
  test('skill surfaces do not contain maintainer-private paths', () => {
    const forbidden = [
      /coordination-board\.md/i,
      /SEEKING_LOG\.md/,
      /RATIONAL_SUBJECT\.md/,
      /VALUE_SIGNAL_LOOP\.md/,
      /C:\\\\LLM Playground\\\\go/i,
    ];
    const leaks: string[] = [];

    for (const filePath of discoverSkillSurface(ROOT)) {
      const content = fs.readFileSync(filePath, 'utf8');
      if (forbidden.some((pattern) => pattern.test(content))) {
        leaks.push(path.relative(ROOT, filePath));
      }
    }

    expect(leaks).toEqual([]);
  });

  test('goldband-slug emits shell-safe project identity', () => {
    const binary = path.join(ROOT, 'bin', 'goldband-slug');
    const result = Bun.spawnSync([binary], {
      cwd: ROOT,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(result.exitCode).toBe(0);
    const values = Object.fromEntries(
      result.stdout
        .toString()
        .trim()
        .split('\n')
        .map((line) => line.split('=', 2)),
    );
    expect(values.SLUG).toMatch(/^[a-zA-Z0-9._-]+$/);
    expect(values.BRANCH).toMatch(/^[a-zA-Z0-9._-]+$/);
  });
});

describe('eval fixture contracts', () => {
  for (const fixture of [
    'qa-eval-ground-truth.json',
    'qa-eval-spa-ground-truth.json',
    'qa-eval-checkout-ground-truth.json',
  ]) {
    test(`${fixture} has internally consistent bug counts`, () => {
      const value = JSON.parse(
        fs.readFileSync(path.join(ROOT, 'test', 'fixtures', fixture), 'utf8'),
      );
      expect(value.bugs.length).toBeGreaterThan(0);
      expect(value.total_bugs).toBe(value.bugs.length);
    });
  }
});

describe('bundled browser skill contracts', () => {
  const browserSkillsRoot = path.join(ROOT, 'browser-skills');

  test('each bundled skill has parseable metadata and executable source assets', async () => {
    const { parseSkillFile } = await import('../browse/src/browser-skills');
    const canonicalClient = fs.readFileSync(
      path.join(ROOT, 'browse', 'src', 'browse-client.ts'),
      'utf8',
    );

    for (const skillDir of bundledSkillDirs(browserSkillsRoot)) {
      const name = path.basename(skillDir);
      const skillPath = path.join(skillDir, 'SKILL.md');
      const scriptPath = path.join(skillDir, 'script.ts');
      const clientPath = path.join(skillDir, '_lib', 'browse-client.ts');
      expect(fs.existsSync(skillPath), name).toBe(true);
      expect(fs.existsSync(scriptPath), name).toBe(true);
      expect(fs.existsSync(path.join(skillDir, 'script.test.ts')), name).toBe(true);
      expect(fs.readFileSync(clientPath, 'utf8'), name).toBe(canonicalClient);

      const { frontmatter } = parseSkillFile(fs.readFileSync(skillPath, 'utf8'), {
        skillName: name,
      });
      expect(frontmatter.name).toBe(name);
      expect(frontmatter.host).not.toBe('');
      expect(Array.isArray(frontmatter.triggers)).toBe(true);
      expect(Array.isArray(frontmatter.args)).toBe(true);
      expect(fs.readFileSync(scriptPath, 'utf8')).toMatch(
        /from\s+['"]\.\/_lib\/browse-client['"]/,
      );
    }
  });
});

function usageShape(value: string): string {
  return value
    .replace(/\(.*?\)/g, '')
    .replace(/<[^>]*>/g, '<>')
    .replace(/\[[^\]]*\]/g, '[]')
    .replace(/\s+/g, ' ')
    .trim();
}

function discoverSkillSurface(root: string): string[] {
  const results: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      if (entry.name.startsWith('.') && entry.name !== '.agents') continue;
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(target);
      if (
        entry.isFile() &&
        (entry.name === 'SKILL.md' || entry.name === 'SKILL.md.tmpl')
      ) {
        results.push(target);
      }
    }
  }
  return results;
}

function bundledSkillDirs(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => path.join(root, entry.name));
}
