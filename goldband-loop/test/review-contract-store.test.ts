import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { getWorkflow } from '../workflows/registry';
import { runWorkflow } from '../workflows/runtime';
import {
  importReviewContract,
  inspectReviewContractStore,
  removeReviewContract,
} from '../workflows/review-contract-store';
import type { ReviewEvidenceManifest } from '../workflows/review-evidence';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('review contract resolution and runtime store', () => {
  test('repository baseline rejects a weaker explicit manifest before evidence execution', async () => {
    const root = temporaryRoot();
    const repo = gitRepository(root, 'repo');
    const state = join(root, 'state');
    writeJson(join(repo, 'goldband.review-evidence.json'), providerManifest());
    writeJson(join(repo, 'weak.json'), noOpManifest());
    writeCandidateDiff(repo);

    await expect(runWorkflow(getWorkflow('review/code'), {
      mode: 'mock',
      host: 'mock',
      cwd: repo,
      goldbandHome: state,
      diffFile: 'candidate.diff',
      evidenceManifestFile: 'weak.json',
    })).rejects.toThrow('review contract laundering blocked: required behavior cell was removed');
  });

  test('runtime-store baseline runs without changing repository status and persists provenance', async () => {
    const root = temporaryRoot();
    const repo = gitRepository(root, 'repo');
    const state = join(root, 'state');
    const manifestFile = join(root, 'central.json');
    writeJson(manifestFile, noOpManifest());
    importReviewContract(repo, state, manifestFile);
    writeCandidateDiff(repo);
    const before = git(repo, ['status', '--porcelain=v1', '--untracked-files=all']);

    const result = await runWorkflow(getWorkflow('review/code'), {
      mode: 'mock',
      host: 'mock',
      cwd: repo,
      goldbandHome: state,
      diffFile: 'candidate.diff',
    });

    expect(git(repo, ['status', '--porcelain=v1', '--untracked-files=all'])).toBe(before);
    const artifactFile = result.artifacts.find((file) => file.endsWith('-review-evidence.json'))!;
    const artifact = JSON.parse(readFileSync(artifactFile, 'utf8'));
    expect(artifact.evidence.contractResolution).toMatchObject({
      compatibilityIdentity: 'review-evidence-schema-v1/runtime-contract-v1',
      baseline: { kind: 'runtime-store' },
    });
    expect(artifact.evidence.contractResolution.effectiveDigest).toBe(
      artifact.binding.behaviorContractDigest,
    );
  });

  test('additive explicit contract passes and records baseline, explicit, and effective digests', async () => {
    const root = temporaryRoot();
    const repo = gitRepository(root, 'repo');
    const state = join(root, 'state');
    const baseline = noOpManifest();
    const effective = structuredClone(baseline);
    effective.behaviorMatrix.push({
      id: 'additive-boundary',
      behavior: 'An additive boundary remains visible.',
      kind: 'boundary',
      input: 'An extended contract.',
      preconditions: 'The baseline remains intact.',
      expected: 'The added cell is evaluated.',
      risk: 'low',
      disposition: 'not-applicable',
      providerIds: [],
      reason: 'Additive resolution fixture.',
    });
    writeJson(join(repo, 'goldband.review-evidence.json'), baseline);
    writeJson(join(repo, 'effective.json'), effective);
    writeCandidateDiff(repo);

    const result = await runWorkflow(getWorkflow('review/code'), {
      mode: 'mock',
      host: 'mock',
      cwd: repo,
      goldbandHome: state,
      diffFile: 'candidate.diff',
      evidenceManifestFile: 'effective.json',
    });
    const artifactFile = result.artifacts.find((file) => file.endsWith('-review-evidence.json'))!;
    const artifact = JSON.parse(readFileSync(artifactFile, 'utf8'));
    expect(artifact.evidence.contractResolution).toMatchObject({
      baseline: { kind: 'repository' },
      explicit: { kind: 'explicit-extension' },
    });
    expect(artifact.evidence.contractResolution.baseline.digest).not.toBe(
      artifact.evidence.contractResolution.effectiveDigest,
    );
    expect(artifact.evidence.contractResolution.explicit.digest).toBe(
      artifact.evidence.contractResolution.effectiveDigest,
    );
  });

  test('repository manifest shadows an existing runtime-store entry', () => {
    const root = temporaryRoot();
    const repo = gitRepository(root, 'repo');
    const state = join(root, 'state');
    const central = join(root, 'central.json');
    writeJson(central, noOpManifest());
    importReviewContract(repo, state, central);
    writeJson(join(repo, 'goldband.review-evidence.json'), providerManifest());

    const inspection = inspectReviewContractStore(repo, state);
    expect(inspection.entry?.manifestDigest).toBeDefined();
    expect(inspection.entry?.manifestDigest).not.toBe(
      hashFromManifestFile(join(repo, 'goldband.review-evidence.json')),
    );
  });

  test('worktrees share one entry while unrelated repositories do not', () => {
    const root = temporaryRoot();
    const repo = gitRepository(root, 'repo');
    const worktree = join(root, 'worktree');
    const unrelated = gitRepository(root, 'unrelated');
    const clone = join(root, 'clone');
    const state = join(root, 'state');
    const central = join(root, 'central.json');
    writeJson(central, noOpManifest());
    git(repo, ['worktree', 'add', '-b', 'test-worktree', worktree]);
    git(root, ['clone', repo, clone]);
    const imported = importReviewContract(repo, state, central);

    expect(inspectReviewContractStore(worktree, state).entryFile).toBe(imported.entryFile);
    expect(inspectReviewContractStore(worktree, state).entry?.manifestDigest).toBe(
      imported.entry?.manifestDigest,
    );
    expect(inspectReviewContractStore(unrelated, state).entry).toBeUndefined();
    expect(inspectReviewContractStore(clone, state).entry).toBeUndefined();
  });

  test('repository moves and remote identity changes require explicit re-import', () => {
    const root = temporaryRoot();
    const repo = gitRepository(root, 'repo');
    const moved = join(root, 'moved');
    const state = join(root, 'state');
    const central = join(root, 'central.json');
    writeJson(central, noOpManifest());
    importReviewContract(repo, state, central);

    git(repo, ['remote', 'add', 'origin', 'https://example.invalid/repository.git']);
    expect(inspectReviewContractStore(repo, state).invalidReason).toContain(
      'review contract store remote identity changed',
    );
    expect(importReviewContract(repo, state, central).entry).toBeDefined();
    git(repo, ['remote', 'remove', 'origin']);
    expect(inspectReviewContractStore(repo, state).invalidReason).toContain(
      'review contract store remote identity changed',
    );
    importReviewContract(repo, state, central);
    renameSync(repo, moved);
    expect(inspectReviewContractStore(moved, state).entry).toBeUndefined();
  });

  test('reusing a repository path cannot inherit the prior repository contract', () => {
    const root = temporaryRoot();
    const repo = gitRepository(root, 'repo');
    const moved = join(root, 'moved');
    const state = join(root, 'state');
    const central = join(root, 'central.json');
    writeJson(central, noOpManifest());
    const imported = importReviewContract(repo, state, central);

    renameSync(repo, moved);
    const replacement = gitRepository(root, 'repo');
    const replacementInspection = inspectReviewContractStore(replacement, state);

    expect(replacementInspection.entryFile).toBe(imported.entryFile);
    expect(replacementInspection.entry).toBeUndefined();
    expect(replacementInspection.invalidReason).toContain(
      'review contract store repository identity mismatch',
    );
    expect(importReviewContract(replacement, state, central).entry).toBeDefined();
  });

  test('import and remove are explicit, private, atomic store operations', () => {
    const root = temporaryRoot();
    const repo = gitRepository(root, 'repo');
    const state = join(root, 'state');
    const central = join(root, 'central.json');
    const symlink = join(root, 'central-link.json');
    writeJson(central, noOpManifest());
    symlinkSync(central, symlink);

    expect(() => importReviewContract(repo, state, symlink)).toThrow(
      'must be a regular file, not a symlink',
    );
    const unsafeState = join(root, 'unsafe-state');
    const unsafeTarget = join(root, 'unsafe-target');
    mkdirSync(unsafeState);
    mkdirSync(unsafeTarget);
    symlinkSync(unsafeTarget, join(unsafeState, 'review-contracts'));
    expect(() => importReviewContract(repo, unsafeState, central)).toThrow(
      'not a private regular directory',
    );
    const imported = importReviewContract(repo, state, central);
    expect(lstatSync(imported.entryFile).mode & 0o777).toBe(0o600);
    expect(removeReviewContract(repo, state).entry).toBeUndefined();
  });

  test('public CLI imports, inspects, and removes with before and after readback', () => {
    const root = temporaryRoot();
    const repo = gitRepository(root, 'repo');
    const state = join(root, 'state');
    const central = join(root, 'central.json');
    writeJson(central, noOpManifest());

    const imported = goldband(repo, state, [
      'review', 'contract', 'import', '--manifest', central,
    ]);
    expect(imported.operation).toBe('import');
    expect(imported.before.configured).toBe(false);
    expect(imported.after.baseline.kind).toBe('runtime-store');

    const inspected = goldband(repo, state, ['review', 'contract', 'inspect']);
    expect(inspected.runtimeStore).toMatchObject({ present: true, shadowed: false });
    expect(inspected.effectiveDigest).toBe(imported.after.effectiveDigest);

    writeJson(join(repo, 'goldband.review-evidence.json'), providerManifest());
    const shadowed = goldband(repo, state, ['review', 'contract', 'inspect']);
    expect(shadowed.baseline.kind).toBe('repository');
    expect(shadowed.runtimeStore).toMatchObject({ present: true, shadowed: true });
    rmSync(join(repo, 'goldband.review-evidence.json'));

    const removed = goldband(repo, state, ['review', 'contract', 'remove']);
    expect(removed.before.configured).toBe(true);
    expect(removed.after.configured).toBe(false);
  });

  test('non-Git directories fail closed instead of guessing an identity', () => {
    const root = temporaryRoot();
    expect(() => inspectReviewContractStore(root, join(root, 'state'))).toThrow(
      'requires an unambiguous Git repository',
    );
  });
});

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'goldband-review-contract-'));
  roots.push(root);
  return root;
}

function gitRepository(root: string, name: string): string {
  const repo = join(root, name);
  git(root, ['init', repo]);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Goldband Test']);
  writeFileSync(join(repo, 'a.ts'), 'old();\n');
  git(repo, ['add', 'a.ts']);
  git(repo, ['commit', '-m', 'fixture']);
  return repo;
}

function writeCandidateDiff(repo: string): void {
  writeFileSync(
    join(repo, 'candidate.diff'),
    'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old();\n+newValue();\n',
  );
}

function noOpManifest(): ReviewEvidenceManifest {
  return {
    schemaVersion: 1,
    behaviorMatrix: [{
      id: 'contract-present',
      behavior: 'The explicit repository contract is present.',
      kind: 'boundary',
      input: 'A review candidate.',
      preconditions: 'The user selected this contract.',
      expected: 'Resolution is deterministic.',
      risk: 'low',
      disposition: 'not-applicable',
      providerIds: [],
      reason: 'No executable provider is needed for the storage fixture.',
    }],
    providers: [],
    authorizations: [],
  };
}

function providerManifest(): ReviewEvidenceManifest {
  return {
    schemaVersion: 1,
    behaviorMatrix: [{
      id: 'required-provider',
      behavior: 'A required provider executes.',
      kind: 'normal',
      input: 'A review candidate.',
      preconditions: 'The repository baseline is active.',
      expected: 'The provider succeeds.',
      risk: 'high',
      disposition: 'automated',
      providerIds: ['required-provider'],
    }],
    providers: [{
      id: 'required-provider',
      owner: 'fixture',
      kind: 'static',
      lifecycle: 'persistent',
      cellIds: ['required-provider'],
      applicability: { kind: 'global', reason: 'Baseline laundering regression fixture.' },
      executionContext: { sandboxOwner: 'review-runtime', runner: 'sealed' },
      operations: [{
        id: 'pass',
        target: 'candidate',
        argv: ['true'],
        expectedExit: 'zero',
        timeoutMs: 1_000,
        maxOutputBytes: 1_024,
        network: 'deny',
        evidenceLevel: 'local',
        requiredSystemTools: [],
      }],
    }],
    authorizations: [],
  };
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function hashFromManifestFile(file: string): string {
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as ReviewEvidenceManifest;
  const stable = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (value && typeof value === 'object') {
      const item = value as Record<string, unknown>;
      return `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${stable(item[key])}`).join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
  };
  return createHash('sha256').update(stable(manifest)).digest('hex');
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  }
  return result.stdout.trim();
}

function goldband(cwd: string, state: string, args: string[]): any {
  const bin = join(dirname(import.meta.dir), 'bin', 'goldband.ts');
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GOLDBAND_HOME: state },
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `goldband ${args.join(' ')} failed`);
  }
  return JSON.parse(result.stdout);
}
