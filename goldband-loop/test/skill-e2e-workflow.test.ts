import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { runSkillTest } from './helpers/session-runner';
import {
  ROOT, browseBin, runId, evalsEnabled,
  describeIfSelected, testConcurrentIfSelected,
  copyDirSync, setupBrowseShims, logCost, recordE2E,
  createEvalCollector, finalizeEvalCollector,
} from './helpers/e2e-helpers';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const evalCollector = createEvalCollector('e2e-workflow');

// --- Document-Release skill E2E ---

describeIfSelected('Document-Release skill E2E', ['document-release'], () => {
  let docReleaseDir: string;

  beforeAll(() => {
    docReleaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-e2e-doc-release-'));

    // Copy document-release skill files
    copyDirSync(path.join(ROOT, 'document-release'), path.join(docReleaseDir, 'document-release'));

    // Init git repo with initial docs
    const run = (cmd: string, args: string[]) =>
      spawnSync(cmd, args, { cwd: docReleaseDir, stdio: 'pipe', timeout: 5000 });

    run('git', ['init', '-b', 'main']);
    run('git', ['config', 'user.email', 'test@test.com']);
    run('git', ['config', 'user.name', 'Test']);

    // Create initial README with a features list
    fs.writeFileSync(path.join(docReleaseDir, 'README.md'),
      '# Test Project\n\n## Features\n\n- Feature A\n- Feature B\n\n## Install\n\n```bash\nnpm install\n```\n');

    // Create initial CHANGELOG that must NOT be clobbered
    fs.writeFileSync(path.join(docReleaseDir, 'CHANGELOG.md'),
      '# Changelog\n\n## 1.0.0 — 2026-03-01\n\n- Initial release with Feature A and Feature B\n- Setup CI pipeline\n');

    // Create VERSION file (already bumped)
    fs.writeFileSync(path.join(docReleaseDir, 'VERSION'), '1.1.0\n');

    run('git', ['add', '.']);
    run('git', ['commit', '-m', 'initial']);

    // Create feature branch with a code change
    run('git', ['checkout', '-b', 'feat/add-feature-c']);
    fs.writeFileSync(path.join(docReleaseDir, 'feature-c.ts'), 'export function featureC() { return "C"; }\n');
    fs.writeFileSync(path.join(docReleaseDir, 'VERSION'), '1.1.1\n');
    fs.writeFileSync(path.join(docReleaseDir, 'CHANGELOG.md'),
      '# Changelog\n\n## 1.1.1 — 2026-03-16\n\n- Added Feature C\n\n## 1.0.0 — 2026-03-01\n\n- Initial release with Feature A and Feature B\n- Setup CI pipeline\n');
    run('git', ['add', '.']);
    run('git', ['commit', '-m', 'feat: add feature C']);
  });

  afterAll(() => {
    try { fs.rmSync(docReleaseDir, { recursive: true, force: true }); } catch {}
  });

  testConcurrentIfSelected('document-release', async () => {
    const result = await runSkillTest({
      prompt: `Read the file document-release/SKILL.md for the document-release workflow instructions.

Run the /document-release workflow on this repo. The base branch is "main".

IMPORTANT:
- Do NOT use AskUserQuestion — auto-approve everything or skip if unsure.
- Do NOT push or create PRs (there is no remote).
- Do NOT run gh commands (no remote).
- Focus on updating README.md to reflect the new Feature C.
- Do NOT overwrite or regenerate CHANGELOG entries.
- Skip VERSION bump (it's already bumped).
- After editing, just commit the changes locally.`,
      workingDirectory: docReleaseDir,
      maxTurns: 30,
      allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Grep', 'Glob'],
      timeout: 180_000,
      testName: 'document-release',
      runId,
    });

    logCost('/document-release', result);

    // Read CHANGELOG to verify it was NOT clobbered
    const changelog = fs.readFileSync(path.join(docReleaseDir, 'CHANGELOG.md'), 'utf-8');
    const hasOriginalEntries = changelog.includes('Initial release with Feature A and Feature B')
      && changelog.includes('Setup CI pipeline')
      && changelog.includes('1.0.0');
    if (!hasOriginalEntries) {
      console.warn('CHANGELOG CLOBBERED — original entries missing!');
    }

    // Check if README was updated
    const readme = fs.readFileSync(path.join(docReleaseDir, 'README.md'), 'utf-8');
    const readmeUpdated = readme.includes('Feature C') || readme.includes('feature-c') || readme.includes('feature C');

    const exitOk = ['success', 'error_max_turns'].includes(result.exitReason);
    recordE2E(evalCollector, '/document-release', 'Document-Release skill E2E', result, {
      passed: exitOk && hasOriginalEntries,
    });

    // Critical guardrail: CHANGELOG must not be clobbered
    expect(hasOriginalEntries).toBe(true);

    // Accept error_max_turns — thorough doc review is not a failure
    expect(['success', 'error_max_turns']).toContain(result.exitReason);

    // Informational: did it update README?
    if (readmeUpdated) {
      console.log('README updated to include Feature C');
    } else {
      console.warn('README was NOT updated — agent may not have found the feature');
    }
  }, 240_000);
});

// setup-cookies-detect REMOVED: The cookie-import-browser module has 30+ thorough
// unit tests in browse/test/cookie-import-browser.test.ts (decryption, profile
// detection, error handling, path traversal). The E2E just tested LLM instruction-
// following ("write a file saying no browsers") on a CI box with no browsers.

// --- goldband-upgrade E2E ---

describeIfSelected('goldband-upgrade E2E', ['goldband-upgrade-happy-path'], () => {
  let upgradeDir: string;
  let remoteDir: string;

  beforeAll(() => {
    upgradeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-e2e-upgrade-'));
    remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-remote-'));

    const run = (cmd: string, args: string[], cwd: string) =>
      spawnSync(cmd, args, { cwd, stdio: 'pipe', timeout: 5000 });

    // Init the "project" repo
    run('git', ['init'], upgradeDir);
    run('git', ['config', 'user.email', 'test@test.com'], upgradeDir);
    run('git', ['config', 'user.name', 'Test'], upgradeDir);

    // Create mock goldband install directory (local-git type)
    const mockGoldband = path.join(upgradeDir, '.claude', 'skills', 'goldband');
    fs.mkdirSync(mockGoldband, { recursive: true });

    // Init as a git repo
    run('git', ['init'], mockGoldband);
    run('git', ['config', 'user.email', 'test@test.com'], mockGoldband);
    run('git', ['config', 'user.name', 'Test'], mockGoldband);

    // Create bare remote
    run('git', ['init', '--bare'], remoteDir);
    run('git', ['remote', 'add', 'origin', remoteDir], mockGoldband);

    // Write old version files
    fs.writeFileSync(path.join(mockGoldband, 'VERSION'), '0.5.0\n');
    fs.writeFileSync(path.join(mockGoldband, 'CHANGELOG.md'),
      '# Changelog\n\n## 0.5.0 — 2026-03-01\n\n- Initial release\n');
    fs.writeFileSync(path.join(mockGoldband, 'setup'),
      '#!/bin/bash\necho "Setup completed"\n', { mode: 0o755 });

    // Initial commit + push
    run('git', ['add', '.'], mockGoldband);
    run('git', ['commit', '-m', 'initial'], mockGoldband);
    run('git', ['push', '-u', 'origin', 'HEAD:main'], mockGoldband);

    // Create new version (simulate upstream release)
    fs.writeFileSync(path.join(mockGoldband, 'VERSION'), '0.6.0\n');
    fs.writeFileSync(path.join(mockGoldband, 'CHANGELOG.md'),
      '# Changelog\n\n## 0.6.0 — 2026-03-15\n\n- New feature: interactive design review\n- Fix: snapshot flag validation\n\n## 0.5.0 — 2026-03-01\n\n- Initial release\n');
    run('git', ['add', '.'], mockGoldband);
    run('git', ['commit', '-m', 'release 0.6.0'], mockGoldband);
    run('git', ['push', 'origin', 'HEAD:main'], mockGoldband);

    // Reset working copy back to old version
    run('git', ['reset', '--hard', 'HEAD~1'], mockGoldband);

    // Copy goldband-upgrade skill
    fs.mkdirSync(path.join(upgradeDir, 'goldband-upgrade'), { recursive: true });
    fs.copyFileSync(
      path.join(ROOT, 'goldband-upgrade', 'SKILL.md'),
      path.join(upgradeDir, 'goldband-upgrade', 'SKILL.md'),
    );

    // Commit so git repo is clean
    run('git', ['add', '.'], upgradeDir);
    run('git', ['commit', '-m', 'initial project'], upgradeDir);
  });

  afterAll(() => {
    try { fs.rmSync(upgradeDir, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(remoteDir, { recursive: true, force: true }); } catch {}
  });

  testConcurrentIfSelected('goldband-upgrade-happy-path', async () => {
    const mockGoldband = path.join(upgradeDir, '.claude', 'skills', 'goldband');
    const result = await runSkillTest({
      prompt: `Read goldband-upgrade/SKILL.md for the upgrade workflow.

You are running /goldband-upgrade standalone. The goldband installation is at ./.claude/skills/goldband (local-git type — it has a .git directory with an origin remote).

Current version: 0.5.0. A new version 0.6.0 is available on origin/main.

Follow the standalone upgrade flow:
1. Detect install type (local-git)
2. Run git fetch origin && git reset --hard origin/main in the install directory
3. Run the setup script
4. Show what's new from CHANGELOG

Skip any AskUserQuestion calls — auto-approve the upgrade. Write a summary of what you did to stdout.

IMPORTANT: The install directory is at ./.claude/skills/goldband — use that exact path.`,
      workingDirectory: upgradeDir,
      maxTurns: 20,
      timeout: 180_000,
      testName: 'goldband-upgrade-happy-path',
      runId,
    });

    logCost('/goldband-upgrade happy path', result);

    // Check that the version was updated
    const versionAfter = fs.readFileSync(path.join(mockGoldband, 'VERSION'), 'utf-8').trim();
    const output = result.output || '';
    const mentionsUpgrade = output.toLowerCase().includes('0.6.0') ||
      output.toLowerCase().includes('upgrade') ||
      output.toLowerCase().includes('updated');

    recordE2E(evalCollector, '/goldband-upgrade happy path', 'goldband-upgrade E2E', result, {
      passed: versionAfter === '0.6.0' && ['success', 'error_max_turns'].includes(result.exitReason),
    });

    expect(['success', 'error_max_turns']).toContain(result.exitReason);
    expect(versionAfter).toBe('0.6.0');
  }, 240_000);
});

// Module-level afterAll — finalize eval collector after all tests complete
afterAll(async () => {
  await finalizeEvalCollector(evalCollector);
});
