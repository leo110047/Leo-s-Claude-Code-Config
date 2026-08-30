import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stateRoot } from './evidence';
import {
  loadReviewEvidenceManifest,
  reviewEvidenceManifestSchema,
  type ReviewEvidenceManifest,
} from './review-evidence';
import {
  digestManifest,
  inspectReviewContractStore,
  resolveReviewContractRepositoryIdentity,
} from './review-contract-store';
import type { ReviewDiffInput } from './review-impact';
import type { WorkflowContext } from './types';

const DEFAULT_REVIEW_EVIDENCE_MANIFEST = 'goldband.review-evidence.json';

type ReviewContractSource = {
  kind: 'repository' | 'runtime-store' | 'explicit-primary' | 'explicit-extension' | 'closure-artifact';
  identity: string;
  digest: string;
};

export type ReviewContractResolution = {
  schemaVersion: 1;
  repositoryIdentity: ReturnType<typeof resolveReviewContractRepositoryIdentity>;
  compatibilityIdentity: 'review-evidence-schema-v1/runtime-contract-v1';
  baseline: ReviewContractSource;
  explicit?: ReviewContractSource;
  effectiveDigest: string;
  shadowedRuntimeStore?: {
    present: boolean;
    digest?: string;
    invalidReason?: string;
  };
};

export type ResolvedReviewContract = {
  manifest: ReviewEvidenceManifest;
  source: string;
  baselineManifest?: ReviewEvidenceManifest;
  resolution: ReviewContractResolution;
};

export function resolveReviewContract(
  ctx: WorkflowContext,
  input: ReviewDiffInput,
): ResolvedReviewContract {
  const repositoryIdentity = resolveReviewContractRepositoryIdentity(ctx.cwd);
  const repositoryFile = join(ctx.cwd, DEFAULT_REVIEW_EVIDENCE_MANIFEST);
  const explicitFile = ctx.options.evidenceManifestFile
    ? resolve(ctx.cwd, ctx.options.evidenceManifestFile)
    : undefined;
  const store = readStoreInspection(ctx);

  let baselineManifest: ReviewEvidenceManifest | undefined;
  let baseline: ReviewContractSource | undefined;
  let shadowedRuntimeStore: ReviewContractResolution['shadowedRuntimeStore'];
  if (existsSync(repositoryFile)) {
    baselineManifest = reviewEvidenceManifestSchema.validate(
      JSON.parse(readFileSync(repositoryFile, 'utf8')),
    );
    baseline = source('repository', realpathSync(repositoryFile), baselineManifest);
    shadowedRuntimeStore = store.entry
      ? { present: true, digest: store.entry.manifestDigest }
      : store.invalidReason
        ? { present: true, invalidReason: store.invalidReason }
        : { present: false };
  } else if (store.entry) {
    baselineManifest = store.entry.manifest;
    baseline = source('runtime-store', store.entryFile, baselineManifest);
  } else if (store.invalidReason) {
    throw new Error(store.invalidReason);
  }

  if (!baselineManifest && !explicitFile && ctx.options.mode === 'mock') {
    const loaded = loadReviewEvidenceManifest(ctx);
    baselineManifest = loaded.manifest;
    baseline = source('explicit-primary', loaded.source, loaded.manifest);
  }

  if (!baselineManifest && !explicitFile) {
    throw new Error(
      'review/code evidence contract is required before semantic review; add goldband.review-evidence.json, run review contract import --manifest <path>, or explicitly pass --evidence-manifest <path>',
    );
  }

  let manifest = baselineManifest;
  let explicit: ReviewContractSource | undefined;
  if (explicitFile) {
    const loaded = baselineManifest
      ? loadReviewEvidenceManifest(ctx, input)
      : {
        manifest: reviewEvidenceManifestSchema.validate(
          JSON.parse(readFileSync(explicitFile, 'utf8')),
        ),
        source: explicitFile,
      };
    manifest = loaded.manifest;
    explicit = source(
      baselineManifest ? 'explicit-extension' : 'explicit-primary',
      realpathSync(explicitFile),
      manifest,
    );
    if (!baseline) baseline = explicit;
  }

  const effective = manifest!;
  return {
    manifest: effective,
    source: explicit?.identity ?? baseline!.identity,
    ...(baselineManifest && explicit ? { baselineManifest } : {}),
    resolution: {
      schemaVersion: 1,
      repositoryIdentity,
      compatibilityIdentity: 'review-evidence-schema-v1/runtime-contract-v1',
      baseline: baseline!,
      ...(explicit ? { explicit } : {}),
      effectiveDigest: digestManifest(effective),
      ...(shadowedRuntimeStore ? { shadowedRuntimeStore } : {}),
    },
  };
}

export function closureArtifactResolution(
  cwd: string,
  manifest: ReviewEvidenceManifest,
  sourceIdentity: string,
): ReviewContractResolution {
  const digest = digestManifest(manifest);
  return {
    schemaVersion: 1,
    repositoryIdentity: resolveReviewContractRepositoryIdentity(cwd),
    compatibilityIdentity: 'review-evidence-schema-v1/runtime-contract-v1',
    baseline: { kind: 'closure-artifact', identity: sourceIdentity, digest },
    effectiveDigest: digest,
  };
}

function source(
  kind: ReviewContractSource['kind'],
  identity: string,
  manifest: ReviewEvidenceManifest,
): ReviewContractSource {
  return { kind, identity, digest: digestManifest(manifest) };
}

function readStoreInspection(ctx: WorkflowContext): {
  entryFile: string;
  entry?: ReturnType<typeof inspectReviewContractStore>['entry'];
  invalidReason?: string;
} {
  try {
    return inspectReviewContractStore(ctx.cwd, stateRoot(ctx.options));
  } catch (error) {
    return {
      entryFile: '',
      invalidReason: error instanceof Error ? error.message : String(error),
    };
  }
}
