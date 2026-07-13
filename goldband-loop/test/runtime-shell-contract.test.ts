import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { TOKEN_CEILING_BYTES } from '../scripts/skill-budget';

const ROOT = path.resolve(import.meta.dir, '..');

describe('generated runtime shell contracts', () => {
  test('ship stays within the prompt byte ceiling', () => {
    const ship = fs.readFileSync(path.join(ROOT, 'ship', 'SKILL.md'), 'utf8');
    expect(new TextEncoder().encode(ship).length).toBeLessThanOrEqual(TOKEN_CEILING_BYTES);
  });

  for (const workflow of ['guard', 'freeze']) {
    test(`${workflow} resolves and persists the freeze boundary in one shell block`, () => {
      const template = fs.readFileSync(
        path.join(ROOT, workflow, 'SKILL.md.tmpl'),
        'utf8',
      );
      const blocks = executableBashBlocks(template);
      const persistBlock = blocks.find((block) => block.includes('freeze-dir.txt'));
      expect(persistBlock).toBeDefined();
      expect(persistBlock).toContain('FREEZE_DIR=$(cd "<user-provided-path>"');
      expect(persistBlock).toContain('ERROR: cannot resolve freeze directory');
    });
  }

  test('upgrade bash blocks initialize workflow-local state before use', () => {
    const template = fs.readFileSync(
      path.join(ROOT, 'goldband-upgrade', 'SKILL.md.tmpl'),
      'utf8',
    );
    const stateVariables = ['INSTALL_DIR', 'OLD_VERSION', 'LOCAL_GOLDBAND'];

    for (const [index, block] of executableBashBlocks(template).entries()) {
      for (const variable of stateVariables) {
        if (!block.includes(`$${variable}`)) continue;
        const helperMode = variable === 'LOCAL_GOLDBAND'
          ? /goldband-upgrade-context" local\)/
          : /goldband-upgrade-context" (?:start|load|local)\)/;
        expect(
          new RegExp(`(?:^|\\n)\\s*${variable}=`).test(block) || helperMode.test(block),
          `upgrade bash block ${index + 1} uses ${variable} from a sibling shell`,
        ).toBe(true);
      }
    }
  });

  test('ship bash blocks recompute version state instead of inheriting sibling shells', () => {
    const template = fs.readFileSync(path.join(ROOT, 'ship', 'SKILL.md.tmpl'), 'utf8');
    const stateVariables = ['BASE_VERSION', 'NEW_VERSION'];

    for (const [index, block] of executableBashBlocks(template).entries()) {
      for (const variable of stateVariables) {
        if (!block.includes(`$${variable}`)) continue;
        expect(
          block,
          `ship bash block ${index + 1} uses ${variable} from a sibling shell`,
        ).toMatch(new RegExp(`(?:^|\\n)\\s*${variable}=`));
      }
    }
  });

  test('upgrade transaction context survives two sibling shells', () => {
    const home = fs.mkdtempSync(path.join(tmpdir(), 'goldband-upgrade-context-'));
    const runtimeRoot = path.join(home, 'runtime with spaces');
    const runtimeBin = path.join(runtimeRoot, 'bin');
    fs.mkdirSync(runtimeBin, { recursive: true });
    for (const binary of ['goldband-env', 'goldband-upgrade-context']) {
      fs.copyFileSync(path.join(ROOT, 'bin', binary), path.join(runtimeBin, binary));
      fs.chmodSync(path.join(runtimeBin, binary), 0o755);
    }
    fs.writeFileSync(path.join(runtimeRoot, 'VERSION'), '1.2.3.4\n');

    const envScript = path.join(runtimeBin, 'goldband-env');
    const localRoot = '.agents/skills/goldband';
    const env = { ...process.env, HOME: home, GOLDBAND_HOME: path.join(home, '.goldband') };
    const bootstrap = `. "${envScript}" "${localRoot}" || exit $?`;

    try {
      const firstShell = Bun.spawnSync(
        ['bash', '-c', `${bootstrap}\n_UPGRADE_CONTEXT=$("$GOLDBAND_BIN/goldband-upgrade-context" start) || exit $?\neval "$_UPGRADE_CONTEXT"\nprintf 'first=%s|%s|%s\n' "$INSTALL_TYPE" "$INSTALL_DIR" "$OLD_VERSION"`],
        { cwd: home, env, stdout: 'pipe', stderr: 'pipe' },
      );
      expect(firstShell.exitCode, decode(firstShell.stderr)).toBe(0);
      const firstContext = decode(firstShell.stdout).trim();
      expect(firstContext).toBe(`first=vendored-global|${runtimeRoot}|1.2.3.4`);

      const secondShell = Bun.spawnSync(
        ['bash', '-c', `${bootstrap}\nprintf 'before=<%s>\n' "\${INSTALL_DIR:-}"\n_UPGRADE_CONTEXT=$("$GOLDBAND_BIN/goldband-upgrade-context" load) || exit $?\neval "$_UPGRADE_CONTEXT"\nprintf 'second=%s|%s|%s\n' "$INSTALL_TYPE" "$INSTALL_DIR" "$OLD_VERSION"`],
        { cwd: home, env, stdout: 'pipe', stderr: 'pipe' },
      );
      expect(secondShell.exitCode, decode(secondShell.stderr)).toBe(0);
      expect(decode(secondShell.stdout)).toContain('before=<>');
      expect(decode(secondShell.stdout)).toContain(firstContext.replace('first=', 'second='));

      const clear = Bun.spawnSync(
        ['bash', '-c', `${bootstrap}\n"$GOLDBAND_BIN/goldband-upgrade-context" clear\n"$GOLDBAND_BIN/goldband-upgrade-context" load`],
        { cwd: home, env, stdout: 'pipe', stderr: 'pipe' },
      );
      expect(clear.exitCode).not.toBe(0);
      expect(decode(clear.stderr)).toContain('upgrade context is missing');

      const failClosed = Bun.spawnSync(
        ['bash', '-c', `${bootstrap}\n_UPGRADE_CONTEXT=$("$GOLDBAND_BIN/goldband-upgrade-context" load) || exit $?\neval "$_UPGRADE_CONTEXT"\necho SHOULD_NOT_RUN`],
        { cwd: home, env, stdout: 'pipe', stderr: 'pipe' },
      );
      expect(failClosed.exitCode).not.toBe(0);
      expect(decode(failClosed.stdout)).not.toContain('SHOULD_NOT_RUN');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test('upgrade local context preserves team mode when runtime paths contain spaces', () => {
    const home = fs.mkdtempSync(path.join(tmpdir(), 'goldband-upgrade-local-'));
    const runtimeRoot = path.join(home, 'runtime with spaces');
    const runtimeBin = path.join(runtimeRoot, 'bin');
    const localRoot = path.join(home, 'project with spaces', '.agents', 'skills', 'goldband');
    fs.mkdirSync(path.join(runtimeRoot, '.git'), { recursive: true });
    fs.mkdirSync(localRoot, { recursive: true });
    fs.mkdirSync(runtimeBin, { recursive: true });
    for (const binary of ['goldband-env', 'goldband-upgrade-context']) {
      fs.copyFileSync(path.join(ROOT, 'bin', binary), path.join(runtimeBin, binary));
      fs.chmodSync(path.join(runtimeBin, binary), 0o755);
    }
    fs.writeFileSync(path.join(runtimeRoot, 'VERSION'), '1.2.3.4\n');
    fs.writeFileSync(
      path.join(runtimeBin, 'goldband-config'),
      '#!/usr/bin/env bash\nprintf \'true\\n\'\n',
      { mode: 0o755 },
    );

    const env = {
      ...process.env,
      HOME: home,
      GOLDBAND_HOME: path.join(home, '.goldband'),
      GOLDBAND_GLOBAL_ROOT: runtimeRoot,
      GOLDBAND_LOCAL_ROOT: localRoot,
      GOLDBAND_BIN: runtimeBin,
    };

    try {
      const start = Bun.spawnSync(
        [path.join(runtimeBin, 'goldband-upgrade-context'), 'start'],
        { cwd: home, env, stdout: 'pipe', stderr: 'pipe' },
      );
      expect(start.exitCode, decode(start.stderr)).toBe(0);

      const local = Bun.spawnSync(
        [path.join(runtimeBin, 'goldband-upgrade-context'), 'local'],
        { cwd: home, env, stdout: 'pipe', stderr: 'pipe' },
      );
      expect(local.exitCode, decode(local.stderr)).toBe(0);
      expect(decode(local.stdout)).toContain(`LOCAL_GOLDBAND=${localRoot.replaceAll(' ', '\\ ')}`);
      expect(decode(local.stdout)).toContain('TEAM_MODE=true');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

function executableBashBlocks(content: string): string[] {
  return [...content.matchAll(/```bash\n([\s\S]*?)```/g)].map((match) => match[1]);
}

function decode(value: Uint8Array | undefined): string {
  return value ? new TextDecoder().decode(value) : '';
}
