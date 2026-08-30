#!/usr/bin/env bun

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
    console.log(JSON.stringify(renderInspection(cwd, before), null, 2));
    return 0;
  }
  const after = command === 'import'
    ? importReviewContract(cwd, stateRoot, manifestFile!)
    : removeReviewContract(cwd, stateRoot);
  console.log(JSON.stringify({
    schemaVersion: 1,
    operation: command,
    before: renderInspection(cwd, before),
    after: renderInspection(cwd, after),
  }, null, 2));
  return 0;
}

function renderInspection(cwd: string, store: ReviewContractStoreInspection) {
  const repositoryFile = join(cwd, 'goldband.review-evidence.json');
  const repositoryManifest = existsSync(repositoryFile)
    ? readRepositoryManifest(repositoryFile)
    : undefined;
  const baseline = repositoryManifest
    ? {
      kind: 'repository' as const,
      identity: realpathSync(repositoryFile),
      digest: digestManifest(repositoryManifest),
    }
    : store.entry
      ? {
        kind: 'runtime-store' as const,
        identity: store.entryFile,
        digest: store.entry.manifestDigest,
      }
      : undefined;
  return {
    schemaVersion: 1,
    repositoryIdentity: store.repository,
    compatibilityIdentity: 'review-evidence-schema-v1/runtime-contract-v1',
    configured: Boolean(baseline),
    baseline: baseline ?? null,
    effectiveDigest: baseline?.digest ?? null,
    runtimeStore: store.entry
      ? {
        present: true,
        shadowed: Boolean(repositoryManifest),
        identity: store.entryFile,
        digest: store.entry.manifestDigest,
        importedFrom: store.entry.importedFrom,
        importedAt: store.entry.importedAt,
      }
      : store.invalidReason
        ? {
          present: true,
          shadowed: Boolean(repositoryManifest),
          identity: store.entryFile,
          invalidReason: store.invalidReason,
        }
        : { present: false, shadowed: false },
  };
}

function readRepositoryManifest(file: string): ReviewEvidenceManifest {
  return reviewEvidenceManifestSchema.validate(
    JSON.parse(readFileSync(resolve(file), 'utf8')),
  );
}

function usage(): never {
  throw new Error(
    'Usage: goldband review contract <inspect|import|remove> [--manifest <path>]',
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
