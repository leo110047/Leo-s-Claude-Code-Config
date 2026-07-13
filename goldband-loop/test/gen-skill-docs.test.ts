import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { COMMAND_DESCRIPTIONS } from '../browse/src/commands';
import { SNAPSHOT_FLAGS } from '../browse/src/snapshot';
import { ALL_HOST_CONFIGS, getExternalHosts } from '../hosts';
import { discoverTemplates } from '../scripts/discover-skills';

const ROOT = path.resolve(import.meta.dir, '..');
const MAX_SKILL_DESCRIPTION_LENGTH = 1024;
const RUNTIME_CONTRACT_VARIABLES = [
  'GLOBAL_ROOT',
  'LOCAL_REL',
  'LOCAL_ROOT',
  'ROOT',
  'BIN',
  'BROWSE',
  'DESIGN',
  'MAKE_PDF',
] as const;
const RUNTIME_CONTRACT_REFERENCE = new RegExp(
  `\\$GOLDBAND_(${RUNTIME_CONTRACT_VARIABLES.join('|')})\\b`,
  'g',
);
const RUNTIME_CONTRACT_INITIALIZER = '/bin/goldband-env';

describe('generated skill contracts', () => {
  test('committed outputs are generator-fresh before any install test runs', () => {
    const result = runGenerator(['--host', 'all', '--dry-run']);
    expect(result.exitCode, decode(result.stderr)).toBe(0);
  });

  test('every Claude template has a fresh generated skill document', () => {
    for (const template of discoverTemplates(ROOT)) {
      if (template.tmpl === 'claude/SKILL.md.tmpl') continue;
      const generatedPath = path.join(ROOT, template.output);
      expect(fs.existsSync(generatedPath), template.output).toBe(true);
      const content = fs.readFileSync(generatedPath, 'utf8');
      expect(content).toContain('<!-- AUTO-GENERATED from SKILL.md.tmpl');
      expect(content).not.toMatch(/\{\{[A-Z][A-Z0-9_]*(?::[^}]*)?\}\}/);
      expect(frontmatterField(content, 'name')).not.toBe('');
      expect(frontmatterField(content, 'description').length).toBeLessThanOrEqual(
        MAX_SKILL_DESCRIPTION_LENGTH,
      );
      for (const block of executableBashBlocks(content)) {
        const references = runtimeContractReferences(block);
        if (references.size > 0) {
          expect(block, `${generatedPath} uses the runtime contract without block-local initialization`)
            .toContain(RUNTIME_CONTRACT_INITIALIZER);
        }
      }
    }
  });

  test('runtime-bearing generator sources use the host-aware root contract', () => {
    const sourceFiles = [
      ...discoverTemplates(ROOT).map((template) => path.join(ROOT, template.tmpl)),
      ...walkFiles(path.join(ROOT, 'scripts', 'resolvers')).filter((file) => file.endsWith('.ts')),
    ];

    for (const sourceFile of sourceFiles) {
      const content = fs.readFileSync(sourceFile, 'utf8');
      expect(content, sourceFile).not.toContain('.claude/skills/goldband');
      expect(content, sourceFile).not.toContain('~/.claude/skills/goldband');
    }
  });

  test('root skill is a thin generated capability router', () => {
    const rootSkill = fs.readFileSync(path.join(ROOT, 'SKILL.md'), 'utf8');
    const router = fs
      .readFileSync(path.join(ROOT, 'generated', 'capability-router.md'), 'utf8')
      .trim();
    expect(rootSkill).toContain(router);
    expect(rootSkill).not.toContain('## Command Reference');
    expect(rootSkill).not.toContain('## Snapshot Flags');
  });

  test('browser manual is generated from browser command metadata', () => {
    const browserManual = fs.readFileSync(
      path.join(ROOT, 'browse', 'SKILL.md'),
      'utf8',
    );
    for (const [command, metadata] of Object.entries(COMMAND_DESCRIPTIONS)) {
      expect(browserManual).toContain(command);
      expect(browserManual).toContain(metadata.description);
    }
    for (const flag of SNAPSHOT_FLAGS) {
      expect(browserManual).toContain(flag.short);
      expect(browserManual).toContain(flag.description);
    }
  });
});

describe('external host generation', () => {
  for (const host of getExternalHosts()) {
    test(`${host.name} output is fresh, parseable, and host-portable`, () => {
      const hostSkills = path.join(ROOT, host.hostSubdir, 'skills');
      expect(fs.existsSync(hostSkills)).toBe(true);

      const generatedSkills = fs
        .readdirSync(hostSkills)
        .map((entry) => path.join(hostSkills, entry))
        .filter((entry) => !isRepoRootSymlink(entry))
        .map((entry) => path.join(entry, 'SKILL.md'))
        .filter((entry) => fs.existsSync(entry));
      expect(generatedSkills.length).toBeGreaterThan(0);

      for (const skillPath of generatedSkills) {
        const content = fs.readFileSync(skillPath, 'utf8');
        expect(frontmatterField(content, 'name')).not.toBe('');
        expect(frontmatterField(content, 'description').length).toBeLessThanOrEqual(
          MAX_SKILL_DESCRIPTION_LENGTH,
        );
        for (const block of executableBashBlocks(content)) {
          const references = runtimeContractReferences(block);
          if (references.size > 0) {
            expect(block, `${skillPath} uses the runtime contract without block-local initialization`)
              .toContain(RUNTIME_CONTRACT_INITIALIZER);
          }
          for (const foreignHost of ALL_HOST_CONFIGS) {
            if (foreignHost.name === host.name) continue;
            expect(block, `${skillPath} contains ${foreignHost.name} runtime path`)
              .not.toContain(`$HOME/${foreignHost.globalRoot}`);
            expect(block, `${skillPath} contains ${foreignHost.name} runtime path`)
              .not.toContain(`~/${foreignHost.globalRoot}`);
          }
        }
      }

    });
  }
});

describe('clean Codex installation', () => {
  test('every capability action resolves the installed runtime root and review assets', () => {
    const home = fs.mkdtempSync(path.join(tmpdir(), 'goldband-codex-install-'));
    try {
      const install = Bun.spawnSync(
        ['bash', 'setup', '--host', 'codex', '--quiet'],
        {
          cwd: ROOT,
          env: {
            ...process.env,
            HOME: home,
            GOLDBAND_SKIP_BUILD: '1',
            GOLDBAND_SKIP_GENERATE: '1',
            GOLDBAND_SKIP_PLAYWRIGHT: '1',
            GOLDBAND_REQUIRE_PLAYWRIGHT: '0',
            GOLDBAND_SKIP_COREUTILS: '1',
          },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      expect(install.exitCode, decode(install.stderr)).toBe(0);

      const runtimeRoot = path.join(home, '.codex', 'skills', 'goldband');
      const contract = JSON.parse(
        fs.readFileSync(path.join(ROOT, 'generated', 'capability-actions.json'), 'utf8'),
      ) as { actions: Array<{ capability: string; action: string }> };
      expect(contract.actions).toHaveLength(51);

      for (const { capability, action } of contract.actions) {
        const workflowPath = path.join(
          runtimeRoot,
          'workflows',
          capability,
          `${action}.workflow.md`,
        );
        expect(fs.existsSync(workflowPath), `${capability}/${action}`).toBe(true);
        const content = fs.readFileSync(workflowPath, 'utf8');
        if (!content.includes('$GOLDBAND_ROOT')) continue;
        expect(
          content,
          `${capability}/${action} must default to the Codex global runtime root`,
        ).toContain('. "$HOME/.codex/skills/goldband/bin/goldband-env" ".agents/skills/goldband" || exit $?');
        for (const block of executableBashBlocks(content)) {
          expect(block).not.toContain('$HOME/.claude/skills/goldband');
          expect(block).not.toContain('~/.claude/skills/goldband');
        }
      }

      const review = fs.readFileSync(
        path.join(runtimeRoot, 'workflows', 'review', 'code.workflow.md'),
        'utf8',
      );
      const dependencies = [
        'review/shared-rubric.md',
        'review/findings-schema.md',
        'review/checklist.md',
      ];
      for (const dependency of dependencies) {
        expect(review).toContain(`$GOLDBAND_ROOT/${dependency}`);
        expect(fs.existsSync(path.join(runtimeRoot, dependency)), dependency).toBe(true);
      }

      const cleanProject = path.join(home, 'project-without-sidecar');
      fs.mkdirSync(cleanProject);
      const runtimeProbe = Bun.spawnSync(
        ['bash', '-c', `${executableBashBlocks(review)[0]}\nprintf 'root=%s\\nbin=%s\\nlocal=%s\\n' "$GOLDBAND_ROOT" "$GOLDBAND_BIN" "$GOLDBAND_LOCAL_ROOT"`],
        { cwd: cleanProject, env: { ...process.env, HOME: home }, stdout: 'pipe', stderr: 'pipe' },
      );
      expect(runtimeProbe.exitCode, decode(runtimeProbe.stderr)).toBe(0);
      expect(decode(runtimeProbe.stdout)).toBe([
        `root=${runtimeRoot}`,
        `bin=${path.join(runtimeRoot, 'bin')}`,
        'local=',
        '',
      ].join('\n'));

      const guard = fs.readFileSync(
        path.join(runtimeRoot, 'workflows', 'safety', 'guard.workflow.md'),
        'utf8',
      );
      const guardBlocks = executableBashBlocks(guard);
      const guardRuntimeBlock = guardBlocks.find((block) => block.includes(RUNTIME_CONTRACT_INITIALIZER));
      const guardConsumerBlock = guardBlocks
        .find((block) => block.includes('goldband-paths'))
        ?.replaceAll('<user-provided-path>', cleanProject);
      expect(guardRuntimeBlock).toBeDefined();
      expect(guardConsumerBlock).toBeDefined();

      const firstShell = Bun.spawnSync(
        ['bash', '-c', `${guardRuntimeBlock}\nprintf 'preamble_bin=<%s>\n' "$GOLDBAND_BIN"`],
        { cwd: cleanProject, env: { ...process.env, HOME: home }, stdout: 'pipe', stderr: 'pipe' },
      );
      expect(firstShell.exitCode, decode(firstShell.stderr)).toBe(0);
      expect(decode(firstShell.stdout)).toContain(`preamble_bin=<${path.join(runtimeRoot, 'bin')}>`);

      const secondShell = Bun.spawnSync(
        ['bash', '-c', `printf 'before_block_bin=<%s>\n' "\${GOLDBAND_BIN:-}"\n${guardConsumerBlock}\nprintf 'next_call_bin=<%s>\nresolved_command=<%s/goldband-paths>\n' "$GOLDBAND_BIN" "$GOLDBAND_BIN"\ntest -x "$GOLDBAND_BIN/goldband-paths"`],
        {
          cwd: cleanProject,
          env: { ...process.env, HOME: home },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      expect(secondShell.exitCode, decode(secondShell.stderr)).toBe(0);
      expect(decode(secondShell.stdout)).toContain('before_block_bin=<>');
      expect(decode(secondShell.stdout)).toContain(`next_call_bin=<${path.join(runtimeRoot, 'bin')}>`);
      expect(decode(secondShell.stdout)).toContain(`resolved_command=<${path.join(runtimeRoot, 'bin', 'goldband-paths')}>`);
      expect(
        fs.readFileSync(path.join(home, '.goldband', 'freeze-dir.txt'), 'utf8'),
      ).toBe(`${cleanProject}/\n`);

      const init = Bun.spawnSync(['git', 'init', '--quiet'], { cwd: cleanProject });
      expect(init.exitCode).toBe(0);
      const localRoot = path.join(cleanProject, '.agents', 'skills', 'goldband');
      fs.mkdirSync(localRoot, { recursive: true });
      const canonicalLocalRoot = fs.realpathSync(localRoot);
      const localProbe = Bun.spawnSync(
        ['bash', '-c', `${executableBashBlocks(review)[0]}\nprintf 'root=%s\\nbin=%s\\nlocal=%s\\n' "$GOLDBAND_ROOT" "$GOLDBAND_BIN" "$GOLDBAND_LOCAL_ROOT"`],
        { cwd: cleanProject, env: { ...process.env, HOME: home }, stdout: 'pipe', stderr: 'pipe' },
      );
      expect(localProbe.exitCode, decode(localProbe.stderr)).toBe(0);
      expect(decode(localProbe.stdout)).toBe([
        `root=${canonicalLocalRoot}`,
        `bin=${path.join(canonicalLocalRoot, 'bin')}`,
        `local=${canonicalLocalRoot}`,
        '',
      ].join('\n'));
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

function runGenerator(args: string[]) {
  return Bun.spawnSync(['bun', 'run', 'scripts/gen-skill-docs.ts', ...args], {
    cwd: ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

function decode(value: Uint8Array | undefined): string {
  return value ? new TextDecoder().decode(value) : '';
}

function runtimeContractReferences(block: string): Set<string> {
  return new Set(
    [...block.matchAll(RUNTIME_CONTRACT_REFERENCE)].map((match) => match[1]),
  );
}

function executableBashBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/```bash\n([\s\S]*?)```/g)].map((match) => match[1]);
}

function frontmatterField(markdown: string, key: string): string {
  const frontmatter = markdown.match(/(?:^|\n)---\n([\s\S]*?)\n---/);
  expect(frontmatter).not.toBeNull();
  const lines = frontmatter?.[1].split('\n') ?? [];
  const inline = lines.find((line) => line.startsWith(`${key}:`));
  expect(inline).toBeDefined();
  const value = inline?.slice(key.length + 1).trim() ?? '';
  if (value && value !== '|') return value;

  const start = lines.indexOf(inline ?? '');
  const block: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line !== '' && !/^\s/.test(line)) break;
    if (line.trim()) block.push(line.trim());
  }
  return block.join(' ');
}

function isRepoRootSymlink(candidate: string): boolean {
  try {
    return fs.realpathSync(candidate) === fs.realpathSync(ROOT);
  } catch {
    return false;
  }
}

function walkFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(candidate) : [candidate];
  });
}
