#!/usr/bin/env bun

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { resolveGoldbandStateRoot } from '../lib/state-root';
import {
  reviewEvidenceManifestSchema,
  type ReviewEvidenceManifest,
} from './review-evidence';
import {
  digestManifest,
  importReviewContract,
  inspectReviewContractStore,
  removeReviewContract,
  type ReviewContractStoreInspection,
} from './review-contract-store';
import { assertReviewContractNotWeaker } from './review-lineage';

type Command = 'inspect' | 'import' | 'remove';

export function runReviewContractCli(args: string[]): number {
  const command = args.shift() as Command | undefined;
  if (!command || !['inspect', 'import', 'remove'].includes(command)) usage();
  let manifestFile: string | undefined;
  let goldbandHome: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === '--manifest' && command === 'import' && value && !manifestFile) {
      manifestFile = value;
    } else if (flag === '--goldband-home' && value && !goldbandHome) {
      goldbandHome = value;
    } else {
      throw new Error(`review contract ${command}: invalid or repeated option ${flag ?? 'option'}`);
    }
    index += 1;
  }
  if (command === 'import' && !manifestFile) {
    throw new Error('review contract import requires --manifest <path>');
  }
  if (command !== 'import' && manifestFile) usage();
  if (goldbandHome && !isAbsolute(goldbandHome)) {
    throw new Error('review contract state root must be absolute');
  }

  const cwd = process.cwd();
  const stateRoot = resolveGoldbandStateRoot(goldbandHome);
  const before = inspectReviewContractStore(cwd, stateRoot);
  if (command === 'inspect') {
    console.log(JSON.stringify(renderInspection(before), null, 2));
    return 0;
  }
  const after = command === 'import'
    ? importReviewContract(cwd, stateRoot, manifestFile!)
    : removeReviewContract(cwd, stateRoot);
  console.log(JSON.stringify({
    schemaVersion: 1,
    operation: command,
    before: renderInspection(before),
    after: renderInspection(after),
  }, null, 2));
  return 0;
}

function renderInspection(store: ReviewContractStoreInspection) {
  const repositoryFile = join(store.workspace.repositoryRoot, 'goldband.review-evidence.json');
  const candidateManifest = existsSync(repositoryFile)
    ? readRepositoryManifest(repositoryFile)
    : undefined;
  const base = readBaseRepositoryManifest(store.workspace.repositoryRoot, candidateManifest);
  const baseManifest = base?.manifest;
  const baseline = baseManifest
    ? {
      kind: 'repository' as const,
      identity: `git:${store.workspace.repositoryRoot}@HEAD:goldband.review-evidence.json`,
      digest: digestManifest(baseManifest),
    }
    : store.entry
      ? {
        kind: 'runtime-store' as const,
        identity: store.entryFile,
        digest: store.entry.manifestDigest,
      }
      : undefined;
  const baselineManifest = baseManifest ?? store.entry?.manifest;
  let candidateCompatibility: { valid: boolean; reason?: string } | null = null;
  if (candidateManifest && baselineManifest) {
    try {
      assertReviewContractNotWeaker(baselineManifest, candidateManifest);
      candidateCompatibility = { valid: true };
    } catch (error) {
      candidateCompatibility = {
        valid: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return {
    schemaVersion: 1,
    repositoryIdentity: store.repository,
    repositoryRoot: store.workspace.repositoryRoot,
    invocationOffset: store.workspace.invocationOffset,
    compatibilityIdentity: 'review-evidence-schema-v2/runtime-contract-v2',
    schemaMigration: base?.migrated
      ? { observedVersion: 1, supportedVersion: 2, source: base.source }
      : null,
    configured: Boolean(baseline),
    baseline: baseline ?? null,
    candidate: candidateManifest
      ? {
        identity: realpathSync(repositoryFile),
        digest: digestManifest(candidateManifest),
        trackingState: manifestTrackingState(store.workspace.repositoryRoot),
        baseDigest: baseManifest ? digestManifest(baseManifest) : null,
      }
      : null,
    candidateCompatibility,
    effectiveDigest: candidateManifest && baseline && candidateCompatibility?.valid
      ? digestManifest(candidateManifest)
      : baseline?.digest ?? null,
    runtimeStore: store.entry
      ? {
        present: true,
        shadowed: Boolean(baseManifest),
        identity: store.entryFile,
        digest: store.entry.manifestDigest,
        importedFrom: store.entry.importedFrom,
        importedAt: store.entry.importedAt,
      }
      : store.invalidReason
        ? {
          present: true,
          shadowed: Boolean(baseManifest),
          identity: store.entryFile,
          invalidReason: store.invalidReason,
        }
        : { present: false, shadowed: false },
  };
}

function readRepositoryManifest(file: string): ReviewEvidenceManifest {
  try {
    return reviewEvidenceManifestSchema.validate(JSON.parse(readFileSync(resolve(file), 'utf8')));
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}; source: ${file}`);
  }
}

function readBaseRepositoryManifest(
  repositoryRoot: string,
  candidateManifest?: ReviewEvidenceManifest,
): { manifest: ReviewEvidenceManifest; migrated: boolean; source: string } | undefined {
  const result = spawnSync('git', ['show', 'HEAD:goldband.review-evidence.json'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) return undefined;
  const source = `git:${repositoryRoot}@HEAD:goldband.review-evidence.json`;
  const value = JSON.parse(result.stdout) as Record<string, unknown>;
  try {
    if (value.schemaVersion === 1 && candidateManifest?.schemaVersion === 2) {
      try {
        return {
          manifest: reviewEvidenceManifestSchema.validate({ ...value, schemaVersion: 2 }),
          migrated: true,
          source,
        };
      } catch {
        reviewEvidenceManifestSchema.validate(value);
      }
    }
    return { manifest: reviewEvidenceManifestSchema.validate(value), migrated: false, source };
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}; source: ${source}`);
  }
}

function manifestTrackingState(repositoryRoot: string): string {
  const trackedInHead = spawnSync(
    'git', ['cat-file', '-e', 'HEAD:goldband.review-evidence.json'], { cwd: repositoryRoot },
  ).status === 0;
  const trackedInIndex = spawnSync(
    'git', ['ls-files', '--error-unmatch', '--', 'goldband.review-evidence.json'], { cwd: repositoryRoot },
  ).status === 0;
  if (!trackedInIndex) return 'untracked';
  if (!trackedInHead) return 'staged-new';
  if (spawnSync('git', ['diff', '--cached', '--quiet', '--', 'goldband.review-evidence.json'], { cwd: repositoryRoot }).status !== 0) {
    return 'staged-modified';
  }
  if (spawnSync('git', ['diff', '--quiet', '--', 'goldband.review-evidence.json'], { cwd: repositoryRoot }).status !== 0) {
    return 'modified';
  }
  return 'unchanged';
}

function usage(): never {
  throw new Error(
    'Usage: goldband review contract inspect | goldband review contract import --manifest <path> | goldband review contract remove',
  );
}

if (import.meta.main) {
  try {
    process.exitCode = runReviewContractCli(process.argv.slice(2));
  } catch (error) {
    console.error(`goldband: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
