import { describe, test as _bunTest, expect, beforeEach, afterEach } from 'bun:test';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Every test in this file shells out to goldband-config + goldband-relink (bash scripts
// invoking subprocess work). Under parallel bun test load, subprocess spawn contends
// with other suites and each test can drift ~200ms past the 5s default. Bump to 15s.
// Object.assign preserves test.only / test.skip / test.each / test.todo sub-APIs.
const test = Object.assign(
  ((name: any, fn: any, timeout?: number) =>
    _bunTest(name, fn, timeout ?? 15_000)) as typeof _bunTest,
  _bunTest,
);

const ROOT = path.resolve(import.meta.dir, '..');
const BIN = path.join(ROOT, 'bin');

let tmpDir: string;
let skillsDir: string;
let installDir: string;

function run(cmd: string, env: Record<string, string> = {}, expectFail = false): string {
  try {
    return execSync(cmd, {
      cwd: ROOT,
      env: { ...process.env, GOLDBAND_STATE_DIR: tmpDir, ...env },
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (e: any) {
    if (expectFail) return (e.stderr || e.stdout || '').toString().trim();
    throw e;
  }
}

// Create a mock goldband install directory with skill subdirs
function setupMockInstall(skills: string[]): void {
  installDir = path.join(tmpDir, 'goldband-install');
  skillsDir = path.join(tmpDir, 'skills');
  fs.mkdirSync(installDir, { recursive: true });
  fs.mkdirSync(skillsDir, { recursive: true });

  // Copy the real goldband-config and goldband-relink to the mock install
  const mockBin = path.join(installDir, 'bin');
  fs.mkdirSync(mockBin, { recursive: true });
  fs.copyFileSync(path.join(BIN, 'goldband-config'), path.join(mockBin, 'goldband-config'));
  fs.chmodSync(path.join(mockBin, 'goldband-config'), 0o755);
  if (fs.existsSync(path.join(BIN, 'goldband-relink'))) {
    fs.copyFileSync(path.join(BIN, 'goldband-relink'), path.join(mockBin, 'goldband-relink'));
    fs.chmodSync(path.join(mockBin, 'goldband-relink'), 0o755);
  }
  if (fs.existsSync(path.join(BIN, 'goldband-patch-names'))) {
    fs.copyFileSync(path.join(BIN, 'goldband-patch-names'), path.join(mockBin, 'goldband-patch-names'));
    fs.chmodSync(path.join(mockBin, 'goldband-patch-names'), 0o755);
  }

  // Create mock skill directories with proper frontmatter
  for (const skill of skills) {
    fs.mkdirSync(path.join(installDir, skill), { recursive: true });
    fs.writeFileSync(
      path.join(installDir, skill, 'SKILL.md'),
      `---\nname: ${skill}\ndescription: test\n---\n# ${skill}`
    );
  }
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-relink-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('goldband-relink (#578)', () => {
  // Test 11: prefixed symlinks when skill_prefix=true
  test('creates goldband-* symlinks when skill_prefix=true', () => {
    setupMockInstall(['qa', 'investigate', 'review']);
    // Set config to prefix mode (pass install/skills env so auto-relink uses mock install)
    run(`${path.join(installDir, 'bin', 'goldband-config')} set skill_prefix true`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    // Run relink with env pointing to the mock install
    const output = run(`${path.join(installDir, 'bin', 'goldband-relink')}`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    // Verify goldband-* symlinks exist
    expect(fs.existsSync(path.join(skillsDir, 'goldband-qa'))).toBe(true);
    expect(fs.existsSync(path.join(skillsDir, 'goldband-investigate'))).toBe(true);
    expect(fs.existsSync(path.join(skillsDir, 'goldband-review'))).toBe(true);
    expect(output).toContain('goldband-');
  });

  // Test 12: flat symlinks when skill_prefix=false
  test('creates flat symlinks when skill_prefix=false', () => {
    setupMockInstall(['qa', 'investigate', 'review']);
    run(`${path.join(installDir, 'bin', 'goldband-config')} set skill_prefix false`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    const output = run(`${path.join(installDir, 'bin', 'goldband-relink')}`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    expect(fs.existsSync(path.join(skillsDir, 'qa'))).toBe(true);
    expect(fs.existsSync(path.join(skillsDir, 'investigate'))).toBe(true);
    expect(fs.existsSync(path.join(skillsDir, 'review'))).toBe(true);
    expect(output).toContain('flat');
  });

  // REGRESSION: unprefixed skills must be real directories, not symlinks (#761)
  // Claude Code auto-prefixes skills nested under a parent dir symlink.
  // e.g., `qa -> goldband/qa` gets discovered as "goldband-qa", not "qa".
  // The fix: create real directories with SKILL.md symlinks inside.
  test('unprefixed skills are real directories with SKILL.md symlinks, not dir symlinks', () => {
    setupMockInstall(['qa', 'investigate', 'review', 'plan-ceo-review']);
    run(`${path.join(installDir, 'bin', 'goldband-config')} set skill_prefix false`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    run(`${path.join(installDir, 'bin', 'goldband-relink')}`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    for (const skill of ['qa', 'investigate', 'review', 'plan-ceo-review']) {
      const skillPath = path.join(skillsDir, skill);
      const skillMdPath = path.join(skillPath, 'SKILL.md');
      // Must be a real directory, NOT a symlink
      expect(fs.lstatSync(skillPath).isDirectory()).toBe(true);
      expect(fs.lstatSync(skillPath).isSymbolicLink()).toBe(false);
      // Must contain a SKILL.md that IS a symlink
      expect(fs.existsSync(skillMdPath)).toBe(true);
      expect(fs.lstatSync(skillMdPath).isSymbolicLink()).toBe(true);
      // The SKILL.md symlink must point to the source skill's SKILL.md
      const target = fs.readlinkSync(skillMdPath);
      expect(target).toContain(skill);
      expect(target).toEndWith('/SKILL.md');
    }
  });

  // Same invariant for prefixed mode
  test('prefixed skills are real directories with SKILL.md symlinks, not dir symlinks', () => {
    setupMockInstall(['qa', 'investigate']);
    run(`${path.join(installDir, 'bin', 'goldband-config')} set skill_prefix true`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    run(`${path.join(installDir, 'bin', 'goldband-relink')}`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    for (const skill of ['goldband-qa', 'goldband-investigate']) {
      const skillPath = path.join(skillsDir, skill);
      const skillMdPath = path.join(skillPath, 'SKILL.md');
      expect(fs.lstatSync(skillPath).isDirectory()).toBe(true);
      expect(fs.lstatSync(skillPath).isSymbolicLink()).toBe(false);
      expect(fs.lstatSync(skillMdPath).isSymbolicLink()).toBe(true);
    }
  });

  // Upgrade: old directory symlinks get replaced with real directories
  test('upgrades old directory symlinks to real directories', () => {
    setupMockInstall(['qa', 'investigate']);
    // Simulate old behavior: create directory symlinks (the old pattern)
    fs.symlinkSync(path.join(installDir, 'qa'), path.join(skillsDir, 'qa'));
    fs.symlinkSync(path.join(installDir, 'investigate'), path.join(skillsDir, 'investigate'));
    // Verify they start as symlinks
    expect(fs.lstatSync(path.join(skillsDir, 'qa')).isSymbolicLink()).toBe(true);

    run(`${path.join(installDir, 'bin', 'goldband-config')} set skill_prefix false`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    run(`${path.join(installDir, 'bin', 'goldband-relink')}`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });

    // After relink: must be real directories, not symlinks
    expect(fs.lstatSync(path.join(skillsDir, 'qa')).isSymbolicLink()).toBe(false);
    expect(fs.lstatSync(path.join(skillsDir, 'qa')).isDirectory()).toBe(true);
    expect(fs.lstatSync(path.join(skillsDir, 'qa', 'SKILL.md')).isSymbolicLink()).toBe(true);
  });

  test('removes the legacy root alias wrapper for the /goldband slash command', () => {
    setupMockInstall(['qa']);
    fs.writeFileSync(
      path.join(installDir, 'SKILL.md'),
      '---\nname: goldband\ndescription: root\n---\n# goldband',
    );
    const aliasDir = path.join(skillsDir, '_goldband-command');
    const aliasSkill = path.join(aliasDir, 'SKILL.md');
    fs.mkdirSync(aliasDir, { recursive: true });
    fs.symlinkSync(path.join(installDir, 'SKILL.md'), aliasSkill);
    fs.writeFileSync(
      path.join(aliasDir, '.goldband-managed-skill'),
      `source=${installDir}\n`,
    );

    run(`${path.join(installDir, 'bin', 'goldband-config')} set skill_prefix false`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    run(`${path.join(installDir, 'bin', 'goldband-relink')}`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });

    expect(fs.existsSync(aliasDir)).toBe(false);

    run(`${path.join(installDir, 'bin', 'goldband-config')} set skill_prefix true`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    run(`${path.join(installDir, 'bin', 'goldband-relink')}`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    expect(fs.existsSync(aliasDir)).toBe(false);
  });

  // FIRST INSTALL: --no-prefix must create ONLY flat names, zero goldband-* pollution
  test('first install --no-prefix: only flat names exist, zero goldband-* entries', () => {
    setupMockInstall(['qa', 'investigate', 'review', 'plan-ceo-review', 'goldband-upgrade']);
    // Simulate first install: no saved config, pass --no-prefix equivalent
    run(`${path.join(installDir, 'bin', 'goldband-config')} set skill_prefix false`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    run(`${path.join(installDir, 'bin', 'goldband-relink')}`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    // Enumerate everything in skills dir
    const entries = fs.readdirSync(skillsDir);
    // Expected: qa, investigate, review, plan-ceo-review, goldband-upgrade (its real name)
    expect(entries.sort()).toEqual(['goldband-upgrade', 'investigate', 'plan-ceo-review', 'qa', 'review']);
    // No goldband-qa, goldband-investigate, goldband-review, goldband-plan-ceo-review
    const leaked = entries.filter(e => e.startsWith('goldband-') && e !== 'goldband-upgrade');
    expect(leaked).toEqual([]);
  });

  // FIRST INSTALL: --prefix must create ONLY goldband-* names, zero flat-name pollution
  test('first install --prefix: only goldband-* entries exist, zero flat names', () => {
    setupMockInstall(['qa', 'investigate', 'review', 'plan-ceo-review', 'goldband-upgrade']);
    run(`${path.join(installDir, 'bin', 'goldband-config')} set skill_prefix true`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    run(`${path.join(installDir, 'bin', 'goldband-relink')}`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    const entries = fs.readdirSync(skillsDir);
    // Expected: goldband-qa, goldband-investigate, goldband-review, goldband-plan-ceo-review, goldband-upgrade
    expect(entries.sort()).toEqual([
      'goldband-investigate', 'goldband-plan-ceo-review', 'goldband-qa', 'goldband-review', 'goldband-upgrade',
    ]);
    // No unprefixed qa, investigate, review, plan-ceo-review
    const leaked = entries.filter(e => !e.startsWith('goldband-'));
    expect(leaked).toEqual([]);
  });

  // FIRST INSTALL: non-TTY (no saved config, piped stdin) defaults to flat names
  test('non-TTY first install defaults to flat names via relink', () => {
    setupMockInstall(['qa', 'investigate']);
    // Don't set any config — simulate fresh install
    // goldband-relink reads config; on fresh install config returns empty → defaults to false
    run(`${path.join(installDir, 'bin', 'goldband-relink')}`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    const entries = fs.readdirSync(skillsDir);
    // Should be flat names (relink defaults to false when config returns empty)
    expect(entries.sort()).toEqual(['investigate', 'qa']);
  });

  // SWITCH: prefix → no-prefix must clean up ALL goldband-* entries
  test('switching prefix to no-prefix removes all goldband-* entries completely', () => {
    setupMockInstall(['qa', 'investigate', 'review', 'plan-ceo-review', 'goldband-upgrade']);
    // Start in prefix mode
    run(`${path.join(installDir, 'bin', 'goldband-config')} set skill_prefix true`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    run(`${path.join(installDir, 'bin', 'goldband-relink')}`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    let entries = fs.readdirSync(skillsDir);
    expect(entries.filter(e => !e.startsWith('goldband-'))).toEqual([]);

    // Switch to no-prefix
    run(`${path.join(installDir, 'bin', 'goldband-config')} set skill_prefix false`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    run(`${path.join(installDir, 'bin', 'goldband-relink')}`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    entries = fs.readdirSync(skillsDir);
    // Only flat names + goldband-upgrade (its real name)
    expect(entries.sort()).toEqual(['goldband-upgrade', 'investigate', 'plan-ceo-review', 'qa', 'review']);
    const leaked = entries.filter(e => e.startsWith('goldband-') && e !== 'goldband-upgrade');
    expect(leaked).toEqual([]);
  });

  // SWITCH: no-prefix → prefix must clean up ALL flat entries
  test('switching no-prefix to prefix removes all flat entries completely', () => {
    setupMockInstall(['qa', 'investigate', 'review', 'goldband-upgrade']);
    // Start in no-prefix mode
    run(`${path.join(installDir, 'bin', 'goldband-config')} set skill_prefix false`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    run(`${path.join(installDir, 'bin', 'goldband-relink')}`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    let entries = fs.readdirSync(skillsDir);
    expect(entries.filter(e => e.startsWith('goldband-') && e !== 'goldband-upgrade')).toEqual([]);

    // Switch to prefix
    run(`${path.join(installDir, 'bin', 'goldband-config')} set skill_prefix true`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    run(`${path.join(installDir, 'bin', 'goldband-relink')}`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    entries = fs.readdirSync(skillsDir);
    // Only goldband-* names
    expect(entries.sort()).toEqual([
      'goldband-investigate', 'goldband-qa', 'goldband-review', 'goldband-upgrade',
    ]);
    const leaked = entries.filter(e => !e.startsWith('goldband-'));
    expect(leaked).toEqual([]);
  });

  // Test 13: cleans stale symlinks from opposite mode
  test('cleans up stale symlinks from opposite mode', () => {
    setupMockInstall(['qa', 'investigate']);
    // Create prefixed symlinks first
    run(`${path.join(installDir, 'bin', 'goldband-config')} set skill_prefix true`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    run(`${path.join(installDir, 'bin', 'goldband-relink')}`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    expect(fs.existsSync(path.join(skillsDir, 'goldband-qa'))).toBe(true);

    // Switch to flat mode
    run(`${path.join(installDir, 'bin', 'goldband-config')} set skill_prefix false`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    run(`${path.join(installDir, 'bin', 'goldband-relink')}`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });

    // Flat symlinks should exist, prefixed should be gone
    expect(fs.existsSync(path.join(skillsDir, 'qa'))).toBe(true);
    expect(fs.existsSync(path.join(skillsDir, 'goldband-qa'))).toBe(false);
  });

  // Test 14: error when install dir missing
  test('prints error when install dir missing', () => {
    const output = run(`${BIN}/goldband-relink`, {
      GOLDBAND_INSTALL_DIR: '/nonexistent/path/goldband',
      GOLDBAND_SKILLS_DIR: '/nonexistent/path/skills',
    }, true);
    expect(output).toContain('setup');
  });

  // Test: goldband-upgrade does NOT get double-prefixed
  test('does not double-prefix goldband-upgrade directory', () => {
    setupMockInstall(['qa', 'investigate', 'goldband-upgrade']);
    run(`${path.join(installDir, 'bin', 'goldband-config')} set skill_prefix true`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    run(`${path.join(installDir, 'bin', 'goldband-relink')}`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    // goldband-upgrade should keep its name, NOT become goldband-goldband-upgrade
    expect(fs.existsSync(path.join(skillsDir, 'goldband-upgrade'))).toBe(true);
    expect(fs.existsSync(path.join(skillsDir, 'goldband-goldband-upgrade'))).toBe(false);
    // Regular skills still get prefixed
    expect(fs.existsSync(path.join(skillsDir, 'goldband-qa'))).toBe(true);
  });

  // Test 15: goldband-config set skill_prefix triggers relink
  test('goldband-config set skill_prefix triggers relink', () => {
    setupMockInstall(['qa', 'investigate']);
    // Run goldband-config set which should auto-trigger relink
    run(`${path.join(installDir, 'bin', 'goldband-config')} set skill_prefix true`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    // If relink was triggered, symlinks should exist
    expect(fs.existsSync(path.join(skillsDir, 'goldband-qa'))).toBe(true);
    expect(fs.existsSync(path.join(skillsDir, 'goldband-investigate'))).toBe(true);
  });
});

describe('upgrade migrations', () => {
  const MIGRATIONS_DIR = path.join(ROOT, 'goldband-upgrade', 'migrations');

  test('migrations directory exists', () => {
    expect(fs.existsSync(MIGRATIONS_DIR)).toBe(true);
  });

  test('all migration scripts are executable and parse without syntax errors', () => {
    const scripts = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sh'));
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) {
      const fullPath = path.join(MIGRATIONS_DIR, script);
      // Must be executable
      const stat = fs.statSync(fullPath);
      expect(stat.mode & 0o111).toBeGreaterThan(0);
      // Must parse without syntax errors (bash -n is a syntax check, doesn't execute)
      const result = execSync(`bash -n "${fullPath}" 2>&1`, { encoding: 'utf-8', timeout: 5000 });
      // bash -n outputs nothing on success
    }
  });

  test('migration filenames follow v{VERSION}.sh pattern', () => {
    const scripts = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sh'));
    for (const script of scripts) {
      expect(script).toMatch(/^v\d+\.\d+\.\d+\.\d+\.sh$/);
    }
  });

  test('v0.15.2.0 migration runs goldband-relink', () => {
    const content = fs.readFileSync(path.join(MIGRATIONS_DIR, 'v0.15.2.0.sh'), 'utf-8');
    expect(content).toContain('goldband-relink');
  });

  test('v0.15.2.0 migration fixes stale directory symlinks', () => {
    setupMockInstall(['qa', 'investigate', 'review']);
    // Simulate old state: directory symlinks (pre-v0.15.2.0 pattern)
    fs.symlinkSync(path.join(installDir, 'qa'), path.join(skillsDir, 'qa'));
    fs.symlinkSync(path.join(installDir, 'investigate'), path.join(skillsDir, 'investigate'));
    fs.symlinkSync(path.join(installDir, 'review'), path.join(skillsDir, 'review'));
    // Set no-prefix mode (suppress auto-relink so symlinks stay intact for the test)
    run(`${path.join(installDir, 'bin', 'goldband-config')} set skill_prefix false`, {
      GOLDBAND_SETUP_RUNNING: '1',
    });
    // Verify old state: symlinks
    expect(fs.lstatSync(path.join(skillsDir, 'qa')).isSymbolicLink()).toBe(true);

    // Run the migration (it calls goldband-relink internally)
    run(`bash ${path.join(MIGRATIONS_DIR, 'v0.15.2.0.sh')}`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });

    // After migration: real directories with SKILL.md symlinks
    for (const skill of ['qa', 'investigate', 'review']) {
      const skillPath = path.join(skillsDir, skill);
      expect(fs.lstatSync(skillPath).isSymbolicLink()).toBe(false);
      expect(fs.lstatSync(skillPath).isDirectory()).toBe(true);
      expect(fs.lstatSync(path.join(skillPath, 'SKILL.md')).isSymbolicLink()).toBe(true);
    }
  });
});

describe('goldband-patch-names (#620/#578)', () => {
  // Helper to read name: from SKILL.md frontmatter
  function readSkillName(skillDir: string): string | null {
    const content = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf-8');
    const match = content.match(/^name:\s*(.+)$/m);
    return match ? match[1].trim() : null;
  }

  test('prefix=true patches name: field in SKILL.md', () => {
    setupMockInstall(['qa', 'investigate', 'review']);
    run(`${path.join(installDir, 'bin', 'goldband-config')} set skill_prefix true`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    run(`${path.join(installDir, 'bin', 'goldband-relink')}`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    // Verify name: field is patched with goldband- prefix
    expect(readSkillName(path.join(installDir, 'qa'))).toBe('goldband-qa');
    expect(readSkillName(path.join(installDir, 'investigate'))).toBe('goldband-investigate');
    expect(readSkillName(path.join(installDir, 'review'))).toBe('goldband-review');
  });

  test('prefix=false restores name: field in SKILL.md', () => {
    setupMockInstall(['qa', 'investigate']);
    // First, prefix them
    run(`${path.join(installDir, 'bin', 'goldband-config')} set skill_prefix true`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    run(`${path.join(installDir, 'bin', 'goldband-relink')}`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    expect(readSkillName(path.join(installDir, 'qa'))).toBe('goldband-qa');
    // Now switch to flat mode
    run(`${path.join(installDir, 'bin', 'goldband-config')} set skill_prefix false`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    run(`${path.join(installDir, 'bin', 'goldband-relink')}`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    // Verify name: field is restored to unprefixed
    expect(readSkillName(path.join(installDir, 'qa'))).toBe('qa');
    expect(readSkillName(path.join(installDir, 'investigate'))).toBe('investigate');
  });

  test('goldband-upgrade name: not double-prefixed', () => {
    setupMockInstall(['qa', 'goldband-upgrade']);
    run(`${path.join(installDir, 'bin', 'goldband-config')} set skill_prefix true`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    run(`${path.join(installDir, 'bin', 'goldband-relink')}`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    // goldband-upgrade should keep its name, NOT become goldband-goldband-upgrade
    expect(readSkillName(path.join(installDir, 'goldband-upgrade'))).toBe('goldband-upgrade');
    // Regular skill should be prefixed
    expect(readSkillName(path.join(installDir, 'qa'))).toBe('goldband-qa');
  });

  test('codex wrapper name is not flattened by prefix=false', () => {
    setupMockInstall(['codex', 'qa']);
    fs.writeFileSync(
      path.join(installDir, 'codex', 'SKILL.md'),
      '---\nname: goldband-codex\ndescription: test\n---\n# codex',
    );

    run(`${path.join(installDir, 'bin', 'goldband-patch-names')} ${installDir} false`);

    expect(readSkillName(path.join(installDir, 'codex'))).toBe('goldband-codex');
    expect(readSkillName(path.join(installDir, 'qa'))).toBe('qa');
  });

  test('SKILL.md without frontmatter is a no-op', () => {
    setupMockInstall(['qa']);
    // Overwrite qa SKILL.md with no frontmatter
    fs.writeFileSync(path.join(installDir, 'qa', 'SKILL.md'), '# qa\nSome content.');
    run(`${path.join(installDir, 'bin', 'goldband-config')} set skill_prefix true`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    // Should not crash
    run(`${path.join(installDir, 'bin', 'goldband-relink')}`, {
      GOLDBAND_INSTALL_DIR: installDir,
      GOLDBAND_SKILLS_DIR: skillsDir,
    });
    // Content should be unchanged (no name: to patch)
    const content = fs.readFileSync(path.join(installDir, 'qa', 'SKILL.md'), 'utf-8');
    expect(content).toBe('# qa\nSome content.');
  });
});
