import { describe, expect, test } from 'bun:test';
import * as path from 'node:path';
import {
  ALL_HOST_CONFIGS,
  ALL_HOST_NAMES,
  HOST_CONFIG_MAP,
  getExternalHosts,
  getHostConfig,
  resolveHostArg,
} from '../hosts';
import { type HostConfig, validateAllConfigs, validateHostConfig } from '../scripts/host-config';

const ROOT = path.resolve(import.meta.dir, '..');

function validConfig(): HostConfig {
  return {
    name: 'test-host',
    displayName: 'Test Host',
    cliCommand: 'testcli',
    globalRoot: '.test/skills/goldband',
    localSkillRoot: '.test/skills/goldband',
    hostSubdir: '.test',
    runtimeRoot: { globalSymlinks: ['bin'] },
  };
}

describe('host registry', () => {
  test('registry is internally consistent', () => {
    expect(ALL_HOST_CONFIGS).toHaveLength(9);
    expect(ALL_HOST_NAMES).toEqual(ALL_HOST_CONFIGS.map((config) => config.name));
    expect(new Set(ALL_HOST_NAMES).size).toBe(ALL_HOST_NAMES.length);
    for (const config of ALL_HOST_CONFIGS) {
      expect(HOST_CONFIG_MAP[config.name]).toBe(config);
    }
    expect(validateAllConfigs(ALL_HOST_CONFIGS)).toEqual([]);
  });

  test('lookup, aliases, and external hosts work', () => {
    expect(getHostConfig('codex').displayName).toBe('OpenAI Codex CLI');
    expect(resolveHostArg('agents')).toBe('codex');
    expect(resolveHostArg('droid')).toBe('factory');
    expect(() => resolveHostArg('missing')).toThrow('Unknown host');
    expect(getExternalHosts().some((config) => config.name === 'claude')).toBe(false);
  });
});

describe('host config validation', () => {
  test('accepts the minimal runtime-owned contract', () => {
    expect(validateHostConfig(validConfig())).toEqual([]);
  });

  test('rejects unsafe names, commands, and paths', () => {
    expect(validateHostConfig({ ...validConfig(), name: 'BAD' })).not.toEqual([]);
    expect(validateHostConfig({ ...validConfig(), cliCommand: 'x;rm' })).not.toEqual([]);
    expect(validateHostConfig({ ...validConfig(), globalRoot: 'has spaces' })).not.toEqual([]);
  });

  test('rejects duplicate ownership paths', () => {
    const first = validConfig();
    const second = { ...validConfig(), name: 'second' };
    const errors = validateAllConfigs([first, second]);
    expect(errors.some((error) => error.includes('Duplicate hostSubdir'))).toBe(true);
    expect(errors.some((error) => error.includes('Duplicate globalRoot'))).toBe(true);
  });
});

describe('host-config-export CLI', () => {
  const script = path.join(ROOT, 'scripts', 'host-config-export.ts');

  function run(...args: string[]) {
    const result = Bun.spawnSync([process.execPath, 'run', script, ...args], {
      cwd: ROOT,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return {
      stdout: result.stdout.toString().trim(),
      stderr: result.stderr.toString().trim(),
      exitCode: result.exitCode,
    };
  }

  test('list and get expose current runtime fields', () => {
    expect(run('list').stdout.split('\n')).toEqual(ALL_HOST_NAMES);
    expect(run('get', 'codex', 'globalRoot').stdout).toBe('.codex/skills/goldband');
    expect(run('get', 'codex', 'frontmatter').exitCode).toBe(1);
  });

  test('validate and symlinks use the slim config', () => {
    expect(run('validate').exitCode).toBe(0);
    const links = run('symlinks', 'codex').stdout.split('\n');
    expect(links).toContain('bin');
    expect(links).toContain('review/checklist.md');
  });
});
