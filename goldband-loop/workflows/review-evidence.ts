import { spawnSync } from 'node:child_process';
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import {
  accessSync,
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  cpSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  readSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ReviewDiffInput } from './review-impact';
import type {
  ReviewClosureResult,
  ReviewFinding,
  ReviewFindingClassification,
  SchemaValidator,
  WorkflowContext,
} from './types';
import { SECRET_CONTENT_RULES } from '../lib/secret-content';
import {
  EVIDENCE_SANDBOX_ACTIVE_ENV,
  EVIDENCE_TEMP_ROOT_ENV,
} from '../lib/evidence-runtime-contract';
import { superviseCommand } from '../scripts/process-supervisor.mjs';
import { stateRoot } from './evidence';

const REVIEW_EVIDENCE_SCHEMA_VERSION = 1;
const MAX_REVIEW_EVIDENCE_OUTPUT_BYTES = 64 * 1024;
const MAX_REVIEW_EVIDENCE_TOTAL_BYTES = 1024 * 1024;
const MAX_REVIEW_EVIDENCE_OPERATIONS = 64;
const MAX_REVIEW_CLOSURE_DELTA_BYTES = 64 * 1024;
const MAX_EVIDENCE_RUNTIME_DIAGNOSTIC_CHARS = 16 * 1024;
const DEFAULT_REVIEW_EVIDENCE_MANIFEST = 'goldband.review-evidence.json';
const EVIDENCE_RUNNER_POLICY = 'per-operation-sealed-runtime-readonly-snapshot-default-deny-read-write-network-v54';
const MAX_REDACTED_UNTRACKED_BYTES = 256 * 1024;
const REVIEW_RECEIPT_TRUSTED_CONFIG_ENV = 'GOLDBAND_REVIEW_RECEIPT_TRUSTED_CONFIG';
const executableDigestCache = new Map<string, string>();
const mockReviewReceiptAuthorityKey = randomBytes(32);
const SYSTEM_SANDBOX_MACH_SERVICES = [
  'com.apple.analyticsd',
  'com.apple.analyticsd.messagetracer',
  'com.apple.appsleep',
  'com.apple.bsd.dirhelper',
  'com.apple.cfprefsd.agent',
  'com.apple.cfprefsd.daemon',
  'com.apple.diagnosticd',
  'com.apple.dt.automationmode.reader',
  'com.apple.espd',
  'com.apple.logd',
  'com.apple.logd.events',
  'com.apple.internal.objc_trace',
  'com.apple.osanalytics.osanalyticshelper',
  'com.apple.runningboard',
  'com.apple.secinitd',
  'com.apple.system.DirectoryService.libinfo_v1',
  'com.apple.system.logger',
  'com.apple.system.notification_center',
  'com.apple.system.opendirectoryd.libinfo',
  'com.apple.system.opendirectoryd.membership',
  'com.apple.trustd',
  'com.apple.trustd.agent',
  'com.apple.xpc.activity.unmanaged',
] as const;

const DISPOSITIONS = new Set<CellDisposition>([
  'automated',
  'static',
  'runtime-readback',
  'manual',
  'not-applicable',
  'unsupported',
]);
const RISKS = new Set<BehaviorRisk>(['low', 'medium', 'high']);
const KINDS = new Set<EvidenceProviderKind>([
  'regression',
  'static',
  'project-gate',
  'property-fuzz',
  'runtime-integration',
]);
const LEVELS = new Set<EvidenceLevel>([
  'fixture',
  'local',
  'sandboxed-service',
  'live-provider',
  'device-platform',
  'production-readback',
]);
const FINDING_CLASSIFICATIONS = new Set<ReviewFindingClassification>([
  'verified-failure',
  'coverage-gap',
  'semantic-concern',
  'runtime-incomplete',
]);
const EVIDENCE_RECORD_STATUSES = new Set<EvidenceRecordStatus>([
  'verified-pass',
  'verified-failure',
  'coverage-gap',
  'runtime-incomplete',
]);
const CLOSURE_STATUSES = new Set([
  'closed',
  'still-open',
  'direct-regression',
  'evidence-incomplete',
]);

type CellDisposition =
  | 'automated'
  | 'static'
  | 'runtime-readback'
  | 'manual'
  | 'not-applicable'
  | 'unsupported';
type BehaviorRisk = 'low' | 'medium' | 'high';
type EvidenceProviderKind =
  | 'regression'
  | 'static'
  | 'project-gate'
  | 'property-fuzz'
  | 'runtime-integration';
type EvidenceLevel =
  | 'fixture'
  | 'local'
  | 'sandboxed-service'
  | 'live-provider'
  | 'device-platform'
  | 'production-readback';

type BehaviorCell = {
  id: string;
  behavior: string;
  kind: 'normal' | 'branch' | 'exception' | 'boundary';
  input: string;
  preconditions: string;
  expected: string;
  risk: BehaviorRisk;
  disposition: CellDisposition;
  providerIds: string[];
  reason?: string;
};

type EvidenceOperation = {
  id: string;
  target: 'base' | 'candidate';
  argv: string[];
  expectedExit: 'zero' | 'nonzero';
  expectedExitCode?: number;
  timeoutMs: number;
  maxOutputBytes: number;
  network: 'deny' | 'authorized';
  authorizationId?: string;
  evidenceLevel: EvidenceLevel;
  requiredSystemTools: string[];
  seed?: string;
  iterations?: number;
};

type EvidenceProvider = {
  id: string;
  owner: string;
  kind: EvidenceProviderKind;
  cellIds: string[];
  changedPathPrefixes: string[];
  operations: EvidenceOperation[];
};

export type ReviewEvidenceManifest = {
  schemaVersion: 1;
  behaviorMatrix: BehaviorCell[];
  providers: EvidenceProvider[];
  authorizations: Array<{
    id: string;
    operation: string;
    scope: string;
    approvedBy: string;
    approvedAt: string;
    expiresAt: string;
  }>;
};

export type CandidateBinding = {
  repository: string;
  baseRef: string;
  baseDigest: string;
  candidateDigest: string;
  scopeDigest: string;
  behaviorContractDigest: string;
  changedFiles: string[];
  redactedUntrackedFiles: Array<{
    path: string;
    digest: string;
    size: number;
    mode: '100644' | '100755';
  }>;
};

type EvidenceRecordStatus =
  | 'verified-pass'
  | 'verified-failure'
  | 'coverage-gap'
  | 'runtime-incomplete';

export type ReviewEvidenceRecord = {
  id: string;
  providerId?: string;
  operationId?: string;
  cellIds: string[];
  owner: string;
  kind: EvidenceProviderKind | 'disposition';
  status: EvidenceRecordStatus;
  evidenceLevel: EvidenceLevel;
  environment: string;
  commandDigest?: string;
  executionIdentityDigest?: string;
  snapshotDigestBefore?: string;
  snapshotDigestAfter?: string;
  replayCommand?: string[];
  seed?: string;
  iterations?: number;
  startedAt: string;
  finishedAt: string;
  exitStatus?: number;
  outputDigest: string;
  outputSummary: string;
  candidateDigest: string;
  baseDigest: string;
  scopeDigest: string;
  fresh: boolean;
};

export type EvidenceCompleteness = {
  complete: boolean;
  hostEligible: boolean;
  blockingCellIds: string[];
  coverageGapCellIds: string[];
  runtimeIncompleteCellIds: string[];
};

export type ReviewEvidenceBundle = {
  schemaVersion: 1;
  manifest: ReviewEvidenceManifest;
  binding: CandidateBinding;
  records: ReviewEvidenceRecord[];
  completeness: EvidenceCompleteness;
  manifestSource: string;
};

export type InitialReviewArtifact = {
  schemaVersion: 1;
  phase: 'initial';
  runId: string;
  binding: CandidateBinding;
  diff: string;
  evidence: ReviewEvidenceBundle;
  findings: ReviewFinding[];
  hostCallCount: 0 | 1;
  createdAt: string;
  runtimeReceipt: {
    schemaVersion: 1;
    id: string;
    digest: string;
    signature: string;
    reviewScope: InitialReviewScope;
  };
};

type InitialReviewArtifactPayload = Omit<InitialReviewArtifact, 'runtimeReceipt'>;

type InitialReviewScope = { kind: 'standalone' } | {
  kind: 'work-map';
  workId: string;
  ticketId: string;
  mapRevision: number;
  claimAttempt: number;
  subjectDigest: string;
};

type InitialReviewRuntimeReceipt = {
  schemaVersion: 1;
  id: string;
  runId: string;
  artifactDigest: string;
  repository: string;
  candidateDigest: string;
  behaviorContractDigest: string;
  findingsDigest: string;
  evidenceDigest: string;
  reviewScope: InitialReviewScope;
  issuedAt: string;
};

export type ClosureReviewInput = {
  artifact: InitialReviewArtifact;
  repairedBinding: CandidateBinding;
  originalBehaviorContractDigest: string;
  repairedBehaviorContractDigest: string;
  repairDelta: string;
  affectedFindingIds: string[];
  affectedCellIds: string[];
};

export const reviewEvidenceManifestSchema: SchemaValidator<ReviewEvidenceManifest> = {
  name: 'review-evidence-manifest',
  validate: validateReviewEvidenceManifest,
};

export const closureResultsSchema: SchemaValidator<ReviewClosureResult[]> = {
  name: 'review-closure-results',
  validate(value) {
    if (!Array.isArray(value)) throw new Error('closure result must be an array');
    return value.map((entry) => {
      const item = asObject(entry, 'closure result');
      const status = requiredString(item.status, 'closure result.status');
      if (!CLOSURE_STATUSES.has(status)) {
        throw new Error(`invalid closure result status: ${status}`);
      }
      return {
        findingId: requiredId(item.findingId, 'closure result.findingId'),
        status: status as ReviewClosureResult['status'],
        summary: requiredString(item.summary, 'closure result.summary'),
        evidenceIds: optionalIdArray(item.evidenceIds, 'closure result.evidenceIds'),
      };
    });
  },
};

export function loadReviewEvidenceManifest(ctx: WorkflowContext): {
  manifest: ReviewEvidenceManifest;
  source: string;
} {
  const configured = ctx.options.evidenceManifestFile;
  if (ctx.options.mode === 'mock' && !configured) {
    return { manifest: mockEvidenceManifest(), source: 'runtime:mock-evidence-manifest' };
  }
  const source = resolve(ctx.cwd, configured ?? DEFAULT_REVIEW_EVIDENCE_MANIFEST);
  if (!existsSync(source)) {
    throw new Error(
      `review/code evidence manifest is required before semantic review: ${source}`,
    );
  }
  const value = JSON.parse(readFileSync(source, 'utf8'));
  return { manifest: validateReviewEvidenceManifest(value), source };
}

export function createCandidateBinding(
  cwd: string,
  input: ReviewDiffInput,
  manifest: ReviewEvidenceManifest,
  requestedBase?: string,
): CandidateBinding {
  const repository = canonicalRepository(cwd);
  const baseRef = requestedBase
    ? gitOutput(cwd, ['merge-base', requestedBase, 'HEAD'], true) || requestedBase
    : 'HEAD';
  const baseIdentity = gitOutput(cwd, ['rev-parse', baseRef], true) || input.source;
  const baseDigest = sha256(baseIdentity);
  const hiddenUntracked = hiddenUntrackedCandidateProjection(cwd, input.diff);
  const candidateDigest = sha256(stableJson({ diff: input.diff, hiddenUntracked }));
  return {
    repository,
    baseRef,
    baseDigest,
    candidateDigest,
    scopeDigest: sha256(stableJson({ source: input.source.replace(/ \+ untracked$/, '') })),
    behaviorContractDigest: sha256(stableJson(manifest)),
    changedFiles: [...input.changedFiles],
    redactedUntrackedFiles: hiddenUntracked,
  };
}

export async function executeEvidencePlan(
  ctx: WorkflowContext,
  input: ReviewDiffInput,
  manifest: ReviewEvidenceManifest,
  binding: CandidateBinding,
  onlyCellIds?: Set<string>,
): Promise<ReviewEvidenceBundle> {
  const tempParent = ctx.options.goldbandHome
    ? join(stateRoot(ctx.options), 'tmp')
    : tmpdir();
  mkdirSync(tempParent, { recursive: true, mode: 0o700 });
  const tempRoot = mkdtempSync(join(tempParent, 'review-evidence-'));
  const records: ReviewEvidenceRecord[] = [];
  const preparedRuntimes = new Map<string, PreparedEvidenceRuntime>();
  let outputBytes = 0;
  try {
    const selectedCells = manifest.behaviorMatrix.filter((cell) =>
      !onlyCellIds || onlyCellIds.has(cell.id));
    const providers = manifest.providers.filter((provider) =>
      provider.cellIds.some((cellId) => selectedCells.some((cell) => cell.id === cellId)) &&
      providerApplies(provider, binding.changedFiles));
    for (const cell of selectedCells) {
      if (cell.disposition === 'not-applicable') {
        records.push(dispositionRecord(cell, binding, 'verified-pass'));
      } else if (cell.disposition === 'unsupported' || cell.disposition === 'manual') {
        records.push(dispositionRecord(cell, binding, 'coverage-gap'));
      }
    }
    for (const provider of providers) {
      for (const operation of provider.operations) {
        if (records.length >= MAX_REVIEW_EVIDENCE_OPERATIONS) {
          throw new Error(`review evidence operation limit exceeded: ${MAX_REVIEW_EVIDENCE_OPERATIONS}`);
        }
        validateOperationAuthorization(operation, manifest);
        const operationKey = `${records.length}-${safePathSegment(provider.id)}-${safePathSegment(operation.id)}`;
        const operationRoot = join(
          tempRoot,
          'operations',
          operationKey,
        );
        const runnerRoot = join(tempRoot, 'runners', operationKey);
        if (operation.target === 'base') {
          materializeBase(ctx.cwd, operationRoot, input.changedFiles, binding.baseRef);
        } else {
          materializeExactCandidate(
            ctx,
            input,
            operationRoot,
            binding.baseRef,
            binding.redactedUntrackedFiles,
          );
        }
        if (operationNeedsDependencies(operation)) {
          projectDependencyDirectories(ctx.cwd, operationRoot, input.changedFiles);
        }
        const dependencyDigest = dependencyProjectionDigest(operationRoot, binding.changedFiles);
        const record = await runEvidenceOperation(
          provider,
          operation,
          operationRoot,
          binding,
          dependencyDigest,
          input.changedFiles,
          runnerRoot,
          join(tempRoot, 'runtime-projections'),
          preparedRuntimes,
        );
        rmSync(operationRoot, { recursive: true, force: true });
        rmSync(runnerRoot, { recursive: true, force: true });
        outputBytes += Buffer.byteLength(record.outputSummary);
        if (outputBytes > MAX_REVIEW_EVIDENCE_TOTAL_BYTES) {
          throw new Error(`review evidence output exceeds ${MAX_REVIEW_EVIDENCE_TOTAL_BYTES} byte total limit`);
        }
        records.push(record);
      }
    }
    const completeness = evaluateEvidenceCompleteness(manifest, records, selectedCells);
    return {
      schemaVersion: REVIEW_EVIDENCE_SCHEMA_VERSION,
      manifest,
      binding,
      records,
      completeness,
      manifestSource: ctx.options.evidenceManifestFile ?? DEFAULT_REVIEW_EVIDENCE_MANIFEST,
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

export function evaluateEvidenceCompleteness(
  manifest: ReviewEvidenceManifest,
  records: ReviewEvidenceRecord[],
  cells = manifest.behaviorMatrix,
): EvidenceCompleteness {
  const blockingCellIds: string[] = [];
  const coverageGapCellIds: string[] = [];
  const runtimeIncompleteCellIds: string[] = [];
  for (const cell of cells) {
    const cellRecords = records.filter((record) => recordAuthorizedForCell(record, cell, manifest));
    if (cellRecords.some((record) => record.status === 'runtime-incomplete')) {
      runtimeIncompleteCellIds.push(cell.id);
      continue;
    }
    if (cell.disposition === 'unsupported' || cell.disposition === 'manual') {
      coverageGapCellIds.push(cell.id);
      if (cell.risk === 'high') blockingCellIds.push(cell.id);
      continue;
    }
    if (cell.disposition === 'not-applicable') continue;
    if (cellRecords.length === 0) {
      coverageGapCellIds.push(cell.id);
      if (cell.risk === 'high') blockingCellIds.push(cell.id);
      continue;
    }
    if (!cellRecords.every((record) => record.fresh)) {
      runtimeIncompleteCellIds.push(cell.id);
    }
  }
  return {
    complete: coverageGapCellIds.length === 0 && runtimeIncompleteCellIds.length === 0,
    hostEligible: runtimeIncompleteCellIds.length === 0 && blockingCellIds.length === 0,
    blockingCellIds: uniqueSorted(blockingCellIds),
    coverageGapCellIds: uniqueSorted(coverageGapCellIds),
    runtimeIncompleteCellIds: uniqueSorted(runtimeIncompleteCellIds),
  };
}

export function classifyReviewFindings(
  findings: ReviewFinding[],
  evidence: ReviewEvidenceBundle,
): ReviewFinding[] {
  const records = new Map(evidence.records.map((record) => [record.id, record]));
  return findings.map((finding, index) => {
    const requested = finding.classification && FINDING_CLASSIFICATIONS.has(finding.classification)
      ? finding.classification
      : 'semantic-concern';
    const requestedCellIds = new Set(finding.behaviorCellIds ?? []);
    const bound = (finding.evidenceIds ?? [])
      .map((id) => records.get(id))
      .filter((record): record is ReviewEvidenceRecord => Boolean(record))
      .filter((record) => requestedCellIds.size > 0 && record.cellIds.some((id) => requestedCellIds.has(id)));
    const validCellIds = new Set(evidence.manifest.behaviorMatrix.map((cell) => cell.id));
    // Only deterministicEvidenceFindings may mint verified-failure. Semantic
    // output can reference relevant records, but cannot promote itself by
    // selecting an unrelated failed command.
    const classification = 'semantic-concern';
    // Finding identity belongs to the runtime. Model-supplied IDs can collide
    // with deterministic findings (or with each other), making the persisted
    // initial artifact impossible to consume during closure.
    const id = `S-${String(index + 1).padStart(3, '0')}`;
    return {
      ...finding,
      id,
      classification,
      category: finding.category === 'deterministic-evidence' ? 'semantic-review' : finding.category,
      evidenceIds: bound.map((record) => record.id),
      behaviorCellIds: uniqueSorted([
        ...(finding.behaviorCellIds ?? []).filter((id) => validCellIds.has(id)),
        ...bound.flatMap((record) => record.cellIds),
      ]),
      // Blocking authority stays deterministic: the host supplies the
      // observation, while runtime severity policy decides ticket state.
      blocking: finding.severity === 'critical' || finding.severity === 'high',
      reproductionStep: classification === 'semantic-concern'
        ? finding.reproductionStep ?? finding.suggestedVerification
        : finding.reproductionStep,
      summary: requested !== 'semantic-concern'
        ? `[unverified concern] ${finding.summary}`
        : finding.summary,
    };
  });
}

export function validateInitialReviewArtifact(value: unknown): InitialReviewArtifact {
  const item = asObject(value, 'initial review artifact');
  if (item.schemaVersion !== 1 || item.phase !== 'initial') {
    throw new Error('invalid initial review artifact header');
  }
  if (item.hostCallCount !== 1) {
    throw new Error('closure requires a completed initial semantic host call');
  }
  const findings = Array.isArray(item.findings) ? item.findings as ReviewFinding[] : undefined;
  if (!findings) throw new Error('initial review artifact.findings must be an array');
  if (findings.length === 0) throw new Error('closure is forbidden when initial review has no findings');
  const ids = findings.map((finding) => requiredId(finding.id, 'initial finding.id'));
  if (new Set(ids).size !== ids.length) throw new Error('initial finding IDs must be unique');
  const artifact = value as InitialReviewArtifact;
  const runtimeReceipt = asObject(artifact.runtimeReceipt, 'initial review artifact.runtimeReceipt');
  if (runtimeReceipt.schemaVersion !== 1) {
    throw new Error('initial review artifact runtime receipt version is invalid');
  }
  requiredId(runtimeReceipt.id, 'initial review artifact.runtimeReceipt.id');
  assertSha256(runtimeReceipt.digest, 'initial review artifact.runtimeReceipt.digest');
  assertSha256(runtimeReceipt.signature, 'initial review artifact.runtimeReceipt.signature');
  validateInitialReviewScope(runtimeReceipt.reviewScope);
  const manifest = validateReviewEvidenceManifest(artifact.evidence?.manifest);
  const binding = artifact.binding;
  if (!binding || typeof binding.repository !== 'string' || typeof binding.baseRef !== 'string') {
    throw new Error('initial review artifact binding is invalid');
  }
  for (const [label, digest] of [
    ['baseDigest', binding.baseDigest],
    ['candidateDigest', binding.candidateDigest],
    ['scopeDigest', binding.scopeDigest],
    ['behaviorContractDigest', binding.behaviorContractDigest],
  ] as const) assertSha256(digest, `initial review artifact.binding.${label}`);
  if (!Array.isArray(binding.redactedUntrackedFiles)) {
    throw new Error('initial review artifact binding redacted untracked projection is invalid');
  }
  const redactedPaths = new Set<string>();
  for (const entry of binding.redactedUntrackedFiles) {
    if (!entry || typeof entry.path !== 'string' || !entry.path ||
        isAbsolute(entry.path) || entry.path.split(/[\\/]/).includes('..') ||
        !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_REDACTED_UNTRACKED_BYTES ||
        !['100644', '100755'].includes(entry.mode)) {
      throw new Error('initial review artifact binding redacted untracked entry is invalid');
    }
    if (redactedPaths.has(entry.path)) {
      throw new Error(`initial review artifact binding repeats redacted untracked path: ${entry.path}`);
    }
    redactedPaths.add(entry.path);
    assertSha256(entry.digest, `initial review artifact binding redacted digest: ${entry.path}`);
  }
  if (Buffer.byteLength(artifact.diff) > 256 * 1024) {
    throw new Error('initial review artifact diff is oversized');
  }
  if (binding.behaviorContractDigest !== sha256(stableJson(manifest)) ||
      stableJson(artifact.evidence.binding) !== stableJson(binding)) {
    throw new Error('initial review artifact evidence binding is mismatched');
  }
  if (!Array.isArray(artifact.evidence.records)) {
    throw new Error('initial review artifact evidence records are invalid');
  }
  const recordIds = new Set<string>();
  for (const record of artifact.evidence.records) {
    validatePersistedEvidenceRecord(record, binding, manifest);
    if (recordIds.has(record.id)) throw new Error('initial evidence record IDs must be unique');
    recordIds.add(record.id);
  }
  const recomputedCompleteness = evaluateEvidenceCompleteness(
    manifest,
    artifact.evidence.records,
    manifest.behaviorMatrix,
  );
  if (stableJson(recomputedCompleteness) !== stableJson(artifact.evidence.completeness)) {
    throw new Error('initial review artifact evidence completeness is not recomputable');
  }
  for (const finding of findings) {
    for (const evidenceId of finding.evidenceIds ?? []) {
      if (!recordIds.has(evidenceId)) throw new Error(`initial finding references unknown evidence: ${evidenceId}`);
    }
  }
  if (!Number.isFinite(Date.parse(artifact.createdAt))) {
    throw new Error('initial review artifact.createdAt is invalid');
  }
  return artifact;
}

function validatePersistedEvidenceRecord(
  record: ReviewEvidenceRecord,
  binding: CandidateBinding,
  manifest: ReviewEvidenceManifest,
): void {
  requiredId(record.id, 'initial evidence record.id');
  if (!Array.isArray(record.cellIds) || record.cellIds.length === 0) {
    throw new Error(`initial evidence record.cellIds must be non-empty: ${record.id}`);
  }
  for (const cellId of record.cellIds) requiredId(cellId, `initial evidence record.cellIds: ${record.id}`);
  requiredString(record.owner, `initial evidence record.owner: ${record.id}`);
  requiredString(record.environment, `initial evidence record.environment: ${record.id}`);
  if (!EVIDENCE_RECORD_STATUSES.has(record.status)) {
    throw new Error(`initial evidence record.status is invalid: ${record.id}`);
  }
  if (!LEVELS.has(record.evidenceLevel)) {
    throw new Error(`initial evidence record.evidenceLevel is invalid: ${record.id}`);
  }
  if (!Number.isFinite(Date.parse(record.startedAt)) || !Number.isFinite(Date.parse(record.finishedAt))) {
    throw new Error(`initial evidence record timestamps are invalid: ${record.id}`);
  }
  assertSha256(record.outputDigest, `initial evidence record.outputDigest: ${record.id}`);
  if (typeof record.outputSummary !== 'string' || Buffer.byteLength(record.outputSummary) > MAX_REVIEW_EVIDENCE_OUTPUT_BYTES) {
    throw new Error(`initial evidence record.outputSummary is invalid: ${record.id}`);
  }
  if (typeof record.fresh !== 'boolean') throw new Error(`initial evidence record.fresh is invalid: ${record.id}`);
  if (
    record.candidateDigest !== binding.candidateDigest ||
    record.baseDigest !== binding.baseDigest ||
    record.scopeDigest !== binding.scopeDigest
  ) {
    throw new Error(`initial evidence record provenance is mismatched: ${record.id}`);
  }
  for (const cellId of record.cellIds) {
    const cell = manifest.behaviorMatrix.find((entry) => entry.id === cellId);
    if (!cell || !recordAuthorizedForCell(record, cell, manifest)) {
      throw new Error(`initial evidence record is not authorized for behavior cell ${cellId}: ${record.id}`);
    }
  }
  if (record.kind === 'disposition') {
    const cell = manifest.behaviorMatrix.find((entry) => entry.id === record.cellIds[0])!;
    const expectedSummary = cell.reason ?? cell.disposition;
    if (record.evidenceLevel !== 'fixture' ||
        record.environment !== 'deterministic-manifest-validation' ||
        record.outputSummary !== expectedSummary ||
        record.outputDigest !== sha256(expectedSummary) ||
        !record.fresh) {
      throw new Error(`initial evidence disposition record contract is invalid: ${record.id}`);
    }
    return;
  }
  if (!record.providerId || !record.operationId) {
    throw new Error(`initial evidence command record lacks provider identity: ${record.id}`);
  }
  const provider = manifest.providers.find((entry) => entry.id === record.providerId);
  const operation = provider?.operations.find((entry) => entry.id === record.operationId);
  if (!provider || !operation || record.id !== `${provider.id}:${operation.id}` ||
      record.owner !== provider.owner || record.kind !== provider.kind ||
      stableJson(record.cellIds) !== stableJson(provider.cellIds) ||
      record.evidenceLevel !== operation.evidenceLevel) {
    throw new Error(`initial evidence command record contract is invalid: ${record.id}`);
  }
  if (record.status === 'coverage-gap') {
    throw new Error(`initial evidence command record cannot claim coverage-gap: ${record.id}`);
  }
  const exitMatches = operation.expectedExit === 'zero'
    ? record.exitStatus === 0
    : record.exitStatus === operation.expectedExitCode;
  if ((record.status === 'verified-pass' && !exitMatches) ||
      (record.status === 'verified-failure' && (record.exitStatus === undefined || exitMatches)) ||
      (record.status === 'runtime-incomplete' && record.fresh)) {
    throw new Error(`initial evidence command record status does not match its exit contract: ${record.id}`);
  }
  assertSha256(record.commandDigest, `initial evidence record.commandDigest: ${record.id}`);
  assertSha256(record.executionIdentityDigest, `initial evidence record.executionIdentityDigest: ${record.id}`);
  assertSha256(record.snapshotDigestBefore, `initial evidence record.snapshotDigestBefore: ${record.id}`);
  assertSha256(record.snapshotDigestAfter, `initial evidence record.snapshotDigestAfter: ${record.id}`);
  if (!Array.isArray(record.replayCommand) || record.replayCommand.length === 0 ||
      record.replayCommand.some((value) => typeof value !== 'string')) {
    throw new Error(`initial evidence record.replayCommand is invalid: ${record.id}`);
  }
  if (record.fresh && record.snapshotDigestBefore !== record.snapshotDigestAfter) {
    throw new Error(`initial evidence record changed its snapshot while marked fresh: ${record.id}`);
  }
}

export function readClosureArtifact(ctx: WorkflowContext): InitialReviewArtifact | undefined {
  if (!ctx.options.closureArtifactFile) return undefined;
  const file = resolve(ctx.cwd, ctx.options.closureArtifactFile);
  const artifact = validateInitialReviewArtifact(JSON.parse(readFileSync(file, 'utf8')));
  validateInitialReviewRuntimeReceipt(ctx, artifact);
  return artifact;
}

export function buildClosureInput(
  artifact: InitialReviewArtifact,
  repairedBinding: CandidateBinding,
  repairedDiff: string,
  repairedManifest: ReviewEvidenceManifest,
): ClosureReviewInput {
  if (artifact.binding.repository !== repairedBinding.repository ||
      artifact.binding.baseRef !== repairedBinding.baseRef ||
      artifact.binding.baseDigest !== repairedBinding.baseDigest ||
      artifact.binding.scopeDigest !== repairedBinding.scopeDigest) {
    throw new Error('closure provenance does not match repository, base, or scope');
  }
  if (artifact.binding.candidateDigest === repairedBinding.candidateDigest) {
    throw new Error('closure requires a repaired candidate with a different digest');
  }
  const patchDelta = diffPatchTexts(artifact.diff, repairedDiff);
  const redactedDelta = redactedUntrackedRepairDelta(
    artifact.binding.redactedUntrackedFiles,
    repairedBinding.redactedUntrackedFiles,
  );
  const repairDelta = [patchDelta, redactedDelta].filter(Boolean).join('\n');
  if (Buffer.byteLength(repairDelta) > MAX_REVIEW_CLOSURE_DELTA_BYTES) {
    throw new Error(
      `review closure repair delta exceeds ${MAX_REVIEW_CLOSURE_DELTA_BYTES} byte limit; narrow the repair scope`,
    );
  }
  const changedFiles = uniqueSorted([
    ...changedFilesBetweenPatchTexts(artifact.diff, repairedDiff),
    ...changedRedactedUntrackedPaths(
      artifact.binding.redactedUntrackedFiles,
      repairedBinding.redactedUntrackedFiles,
    ),
  ]);
  const findingCellIds = artifact.findings.flatMap((finding) =>
    uniqueSorted([
      ...(finding.behaviorCellIds ?? []),
      ...evidenceCellsForFinding(finding, artifact.evidence),
    ])
      .filter((cellId) => cellAffectedByPaths(cellId, repairedManifest, changedFiles)));
  const contractChangedCellIds = repairedManifest.behaviorMatrix
    .map((cell) => cell.id)
    .filter((cellId) =>
      cellContractDigest(artifact.evidence.manifest, cellId) !==
      cellContractDigest(repairedManifest, cellId));
  const affectedCellIds = uniqueSorted([
    ...findingCellIds,
    ...contractChangedCellIds,
  ]);
  return {
    artifact,
    repairedBinding,
    originalBehaviorContractDigest: artifact.binding.behaviorContractDigest,
    repairedBehaviorContractDigest: repairedBinding.behaviorContractDigest,
    repairDelta,
    affectedFindingIds: artifact.findings.map((finding) => finding.id!),
    affectedCellIds,
  };
}

export function validateClosureResults(
  results: ReviewClosureResult[],
  input: ClosureReviewInput,
  evidence: ReviewEvidenceBundle,
): ReviewClosureResult[] {
  const allowed = new Set(input.affectedFindingIds);
  const evidenceById = new Map(evidence.records.map((record) => [record.id, record]));
  const originalEvidenceById = new Map(
    input.artifact.evidence.records.map((record) => [record.id, record]),
  );
  const originalFindingsById = new Map(
    input.artifact.findings.map((finding) => [finding.id!, finding]),
  );
  const seen = new Set<string>();
  for (const result of results) {
    if (!allowed.has(result.findingId)) {
      throw new Error(`closure returned non-original finding ID: ${result.findingId}`);
    }
    if (seen.has(result.findingId)) throw new Error(`duplicate closure finding ID: ${result.findingId}`);
    seen.add(result.findingId);
    const evidenceIds = result.evidenceIds ?? [];
    const rerunRecords = evidenceIds.map((id) => evidenceById.get(id));
    if (rerunRecords.some((record) => !record)) {
      throw new Error(`closure references unknown rerun evidence: ${result.findingId}`);
    }
    if (result.status === 'direct-regression' &&
        !rerunRecords.some((record) => record?.status === 'verified-failure')) {
      throw new Error(`closure direct-regression requires verified rerun evidence: ${result.findingId}`);
    }
    if (result.status === 'evidence-incomplete') continue;
    if (rerunRecords.length === 0) {
      throw new Error(`closure ${result.status} requires fresh rerun evidence: ${result.findingId}`);
    }
    const finding = originalFindingsById.get(result.findingId)!;
    const findingCellIds = new Set([
      ...(finding.behaviorCellIds ?? []),
      ...evidenceCellsForFinding(finding, input.artifact.evidence),
    ]);
    if (findingCellIds.size === 0) {
      throw new Error(`closure ${result.status} has no behavior-cell evidence binding: ${result.findingId}`);
    }
    if (rerunRecords.some((record) =>
      !record?.cellIds.some((cellId) => findingCellIds.has(cellId)))) {
      throw new Error(`closure references evidence unrelated to finding behavior cells: ${result.findingId}`);
    }
    if (result.status === 'closed') {
      if (!rerunRecords.every((record) => record?.status === 'verified-pass' && record.fresh)) {
        throw new Error(`closure closed requires passing fresh rerun evidence: ${result.findingId}`);
      }
      if (finding.classification === 'verified-failure') {
        const failedIds = (finding.evidenceIds ?? []).filter(
          (id) => originalEvidenceById.get(id)?.status === 'verified-failure',
        );
        if (
          failedIds.length === 0 ||
          !failedIds.every((id) => {
            const original = originalEvidenceById.get(id);
            const rerun = evidenceById.get(id);
            return rerun?.status === 'verified-pass' &&
              Boolean(original?.commandDigest) &&
              sameEvidenceOperationContract(
                original!,
                input.artifact.evidence.manifest,
                rerun,
                evidence.manifest,
              );
          })
        ) {
          throw new Error(
            `closure verified failure requires the unchanged original failed operation to pass: ${result.findingId}`,
          );
        }
      }
    }
  }
  for (const findingId of input.affectedFindingIds) {
    if (!seen.has(findingId)) throw new Error(`closure omitted original finding ID: ${findingId}`);
  }
  return results;
}

function sameEvidenceOperationContract(
  original: ReviewEvidenceRecord,
  originalManifest: ReviewEvidenceManifest,
  rerun: ReviewEvidenceRecord,
  rerunManifest: ReviewEvidenceManifest,
): boolean {
  if (!original.providerId || !original.operationId ||
      original.providerId !== rerun.providerId || original.operationId !== rerun.operationId) return false;
  const contract = (manifest: ReviewEvidenceManifest, record: ReviewEvidenceRecord) => {
    const provider = manifest.providers.find((entry) => entry.id === record.providerId);
    const operation = provider?.operations.find((entry) => entry.id === record.operationId);
    return provider && operation ? stableJson({
      provider: {
        id: provider.id,
        owner: provider.owner,
        kind: provider.kind,
        cellIds: provider.cellIds,
      },
      operation: {
        id: operation.id,
        target: operation.target,
        argv: operation.argv,
        expectedExit: operation.expectedExit,
        expectedExitCode: operation.expectedExitCode ?? null,
        timeoutMs: operation.timeoutMs,
        maxOutputBytes: operation.maxOutputBytes,
        network: operation.network,
        authorizationId: operation.authorizationId ?? null,
        evidenceLevel: operation.evidenceLevel,
        requiredSystemTools: operation.requiredSystemTools ?? [],
        seed: operation.seed ?? null,
        iterations: operation.iterations ?? null,
      },
    }) : undefined;
  };
  return contract(originalManifest, original) === contract(rerunManifest, rerun);
}

function cellContractDigest(
  manifest: ReviewEvidenceManifest,
  cellId: string,
): string | undefined {
  const cell = manifest.behaviorMatrix.find((entry) => entry.id === cellId);
  if (!cell) return undefined;
  const providers = manifest.providers.filter((provider) => provider.cellIds.includes(cellId));
  return sha256(stableJson({ cell, providers }));
}

function validateReviewEvidenceManifest(value: unknown): ReviewEvidenceManifest {
  const item = asObject(value, 'review evidence manifest');
  if (item.schemaVersion !== REVIEW_EVIDENCE_SCHEMA_VERSION) {
    throw new Error(`review evidence manifest.schemaVersion must be ${REVIEW_EVIDENCE_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(item.behaviorMatrix) || item.behaviorMatrix.length === 0) {
    throw new Error('review evidence manifest.behaviorMatrix must be non-empty');
  }
  if (!Array.isArray(item.providers)) throw new Error('review evidence manifest.providers must be an array');
  if (!Array.isArray(item.authorizations)) throw new Error('review evidence manifest.authorizations must be an array');
  const behaviorMatrix = item.behaviorMatrix.map(validateBehaviorCell);
  const providers = item.providers.map(validateEvidenceProvider);
  const authorizations = item.authorizations.map((value) => {
    const auth = asObject(value, 'evidence authorization');
    return {
      id: requiredId(auth.id, 'authorization.id'),
      operation: requiredString(auth.operation, 'authorization.operation'),
      scope: requiredString(auth.scope, 'authorization.scope'),
      approvedBy: requiredString(auth.approvedBy, 'authorization.approvedBy'),
      approvedAt: validDate(auth.approvedAt, 'authorization.approvedAt'),
      expiresAt: validDate(auth.expiresAt, 'authorization.expiresAt'),
    };
  });
  assertUnique(behaviorMatrix.map((cell) => cell.id), 'behavior cell');
  assertUnique(providers.map((provider) => provider.id), 'evidence provider');
  assertUnique(authorizations.map((authorization) => authorization.id), 'evidence authorization');
  const cellIds = new Set(behaviorMatrix.map((cell) => cell.id));
  const providerIds = new Set(providers.map((provider) => provider.id));
  for (const cell of behaviorMatrix) {
    for (const providerId of cell.providerIds) {
      if (!providerIds.has(providerId)) throw new Error(`behavior cell ${cell.id} references unknown provider ${providerId}`);
      const provider = providers.find((entry) => entry.id === providerId)!;
      if (!provider.cellIds.includes(cell.id)) {
        throw new Error(`behavior cell ${cell.id} and provider ${providerId} must authorize each other`);
      }
    }
  }
  for (const provider of providers) {
    assertUnique(
      provider.operations.map((operation) => operation.id),
      `evidence provider ${provider.id} operation`,
    );
    for (const cellId of provider.cellIds) {
      if (!cellIds.has(cellId)) throw new Error(`evidence provider ${provider.id} references unknown cell ${cellId}`);
      const cell = behaviorMatrix.find((entry) => entry.id === cellId)!;
      if (!cell.providerIds.includes(provider.id)) {
        throw new Error(`evidence provider ${provider.id} and behavior cell ${cellId} must authorize each other`);
      }
    }
    validateProviderContract(provider);
  }
  return { schemaVersion: 1, behaviorMatrix, providers, authorizations };
}

function validateBehaviorCell(value: unknown): BehaviorCell {
  const item = asObject(value, 'behavior cell');
  const kind = requiredString(item.kind, 'behavior cell.kind');
  if (!['normal', 'branch', 'exception', 'boundary'].includes(kind)) {
    throw new Error(`invalid behavior cell kind: ${kind}`);
  }
  const risk = requiredString(item.risk, 'behavior cell.risk') as BehaviorRisk;
  if (!RISKS.has(risk)) throw new Error(`invalid behavior cell risk: ${risk}`);
  const disposition = requiredString(item.disposition, 'behavior cell.disposition') as CellDisposition;
  if (!DISPOSITIONS.has(disposition)) throw new Error(`invalid behavior cell disposition: ${disposition}`);
  const providerIds = optionalIdArray(item.providerIds, 'behavior cell.providerIds') ?? [];
  const reason = optionalString(item.reason);
  if (['not-applicable', 'unsupported', 'manual'].includes(disposition) && !reason) {
    throw new Error(`behavior cell ${String(item.id)} disposition ${disposition} requires a reason`);
  }
  if (!['not-applicable', 'unsupported', 'manual'].includes(disposition) && providerIds.length === 0) {
    throw new Error(`behavior cell ${String(item.id)} disposition ${disposition} requires a provider`);
  }
  return {
    id: requiredId(item.id, 'behavior cell.id'),
    behavior: requiredString(item.behavior, 'behavior cell.behavior'),
    kind: kind as BehaviorCell['kind'],
    input: requiredString(item.input, 'behavior cell.input'),
    preconditions: requiredString(item.preconditions, 'behavior cell.preconditions'),
    expected: requiredString(item.expected, 'behavior cell.expected'),
    risk,
    disposition,
    providerIds,
    ...(reason ? { reason } : {}),
  };
}

function validateEvidenceProvider(value: unknown): EvidenceProvider {
  const item = asObject(value, 'evidence provider');
  const kind = requiredString(item.kind, 'evidence provider.kind') as EvidenceProviderKind;
  if (!KINDS.has(kind)) throw new Error(`invalid evidence provider kind: ${kind}`);
  if (!Array.isArray(item.operations) || item.operations.length === 0) {
    throw new Error(`evidence provider ${String(item.id)} operations must be non-empty`);
  }
  return {
    id: requiredId(item.id, 'evidence provider.id'),
    owner: requiredString(item.owner, 'evidence provider.owner'),
    kind,
    cellIds: requiredIdArray(item.cellIds, 'evidence provider.cellIds'),
    changedPathPrefixes: optionalStringArray(item.changedPathPrefixes, 'evidence provider.changedPathPrefixes'),
    operations: item.operations.map(validateEvidenceOperation),
  };
}

function validateEvidenceOperation(value: unknown): EvidenceOperation {
  const item = asObject(value, 'evidence operation');
  const target = requiredString(item.target, 'evidence operation.target');
  if (target !== 'base' && target !== 'candidate') throw new Error(`invalid evidence operation target: ${target}`);
  const expectedExit = requiredString(item.expectedExit, 'evidence operation.expectedExit');
  if (expectedExit !== 'zero' && expectedExit !== 'nonzero') {
    throw new Error(`invalid evidence operation.expectedExit: ${expectedExit}`);
  }
  const network = requiredString(item.network, 'evidence operation.network');
  if (network !== 'deny' && network !== 'authorized') throw new Error(`invalid evidence operation.network: ${network}`);
  const evidenceLevel = requiredString(item.evidenceLevel, 'evidence operation.evidenceLevel') as EvidenceLevel;
  if (!LEVELS.has(evidenceLevel)) throw new Error(`invalid evidence level: ${evidenceLevel}`);
  if (
    ['live-provider', 'device-platform', 'production-readback'].includes(evidenceLevel) &&
    network !== 'authorized'
  ) {
    throw new Error(
      `evidence level ${evidenceLevel} requires an authorized external runner`,
    );
  }
  const argv = requiredStringArray(item.argv, 'evidence operation.argv');
  if (argv[0]!.includes('/') || argv[0]!.includes('\\')) {
    throw new Error('evidence operation executable must be a PATH-resolved command name');
  }
  const requiredSystemTools = optionalStringArray(
    item.requiredSystemTools,
    'evidence operation.requiredSystemTools',
  );
  for (const tool of requiredSystemTools) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(tool)) {
      throw new Error(`invalid evidence system tool name: ${tool}`);
    }
  }
  const timeoutMs = boundedInteger(item.timeoutMs, 'evidence operation.timeoutMs', 100, 15 * 60 * 1000);
  const maxOutputBytes = boundedInteger(
    item.maxOutputBytes,
    'evidence operation.maxOutputBytes',
    1,
    MAX_REVIEW_EVIDENCE_OUTPUT_BYTES,
  );
  const expectedExitCode = item.expectedExitCode === undefined
    ? undefined
    : boundedInteger(item.expectedExitCode, 'evidence operation.expectedExitCode', 1, 255);
  if (expectedExit === 'nonzero' && expectedExitCode === undefined) {
    throw new Error(`evidence operation ${String(item.id)} expectedExit nonzero requires expectedExitCode`);
  }
  if (expectedExit === 'zero' && expectedExitCode !== undefined) {
    throw new Error(`evidence operation ${String(item.id)} expectedExit zero cannot declare expectedExitCode`);
  }
  return {
    id: requiredId(item.id, 'evidence operation.id'),
    target: target as EvidenceOperation['target'],
    argv,
    expectedExit: expectedExit as EvidenceOperation['expectedExit'],
    expectedExitCode,
    timeoutMs,
    maxOutputBytes,
    network: network as EvidenceOperation['network'],
    authorizationId: optionalString(item.authorizationId),
    evidenceLevel,
    requiredSystemTools: uniqueSorted(requiredSystemTools),
    seed: optionalString(item.seed),
    iterations: item.iterations === undefined
      ? undefined
      : boundedInteger(item.iterations, 'evidence operation.iterations', 1, 1_000_000),
  };
}

function validateProviderContract(provider: EvidenceProvider): void {
  const base = provider.operations.filter((operation) => operation.target === 'base');
  const candidate = provider.operations.filter((operation) => operation.target === 'candidate');
  if (provider.kind === 'regression' &&
      !(base.some((operation) => operation.expectedExit === 'nonzero') &&
        candidate.some((operation) => operation.expectedExit === 'zero'))) {
    throw new Error(`regression provider ${provider.id} requires base/nonzero RED and candidate/zero GREEN operations`);
  }
  if (provider.kind !== 'regression' && base.length > 0) {
    throw new Error(`only regression providers may execute against base: ${provider.id}`);
  }
  if (provider.kind === 'property-fuzz') {
    for (const operation of provider.operations) {
      if (!operation.seed || !operation.iterations) {
        throw new Error(`property/fuzz provider ${provider.id} requires seed and iterations`);
      }
    }
  }
  if (provider.kind === 'runtime-integration' &&
      provider.operations.some((operation) => !LEVELS.has(operation.evidenceLevel))) {
    throw new Error(`runtime integration provider ${provider.id} requires an evidence level`);
  }
}

function validateOperationAuthorization(
  operation: EvidenceOperation,
  manifest: ReviewEvidenceManifest,
): void {
  if (operation.network === 'deny') {
    if (operation.authorizationId) throw new Error(`network-denied operation ${operation.id} cannot carry authorization`);
    return;
  }
  if (!operation.authorizationId) throw new Error(`network operation ${operation.id} requires typed authorization`);
  const authorization = manifest.authorizations.find((entry) => entry.id === operation.authorizationId);
  if (!authorization || authorization.operation !== operation.id) {
    throw new Error(`network operation ${operation.id} authorization is missing or mismatched`);
  }
  const now = Date.now();
  if (Date.parse(authorization.approvedAt) > now || Date.parse(authorization.expiresAt) <= now) {
    throw new Error(`network operation ${operation.id} authorization is not currently valid`);
  }
  throw new Error(
    `network operation ${operation.id} requires an operation-specific external runner; local review runner is deny-only`,
  );
}

type PreparedEvidenceRuntime = {
  command: string;
  access: EvidenceRuntimeReadAccess;
  identityDigest: string;
  environment: Record<string, string>;
  verifyUnchanged: () => boolean;
};

function prepareEvidenceRuntime(
  command: string,
  runnerRoot: string,
  sourceAccess: EvidenceRuntimeReadAccess,
): PreparedEvidenceRuntime {
  if (process.platform !== 'darwin' || sourceAccess.links.length === 0) {
    return {
      command,
      access: sourceAccess,
      identityDigest: sourceAccess.identityDigest,
      environment: {},
      verifyUnchanged: () => true,
    };
  }
  const runtimeRoot = join(runnerRoot, 'runtime');
  const runtimeBin = join(runtimeRoot, 'bin');
  mkdirSync(runtimeBin, { recursive: true });
  const realRuntimeBin = realpathSync(runtimeBin);
  const projectedBySource = new Map<string, string>();
  const executableSource = realpathSync(command);
  const executableName = basename(executableSource);
  const sourceByProjectedName = new Map<string, string>();
  let projectedLibraryIndex = 0;
  for (const image of sourceAccess.images) {
    let name = executableName;
    if (image.sourcePath !== executableSource) {
      do {
        name = `_${projectedLibraryIndex.toString(36)}`;
        projectedLibraryIndex += 1;
      } while (name === executableName);
    }
    const existing = sourceByProjectedName.get(name);
    if (existing && existing !== image.sourcePath) {
      throw new Error(`review evidence runtime projection basename collision: ${name}`);
    }
    const destination = join(realRuntimeBin, name);
    if (!existing) {
      copyFileSync(image.sourcePath, destination, constants.COPYFILE_EXCL);
      if (runtimeImageContentDigest(destination) !== image.contentDigest) {
        throw new Error(`review evidence runtime image changed while projecting: ${image.sourcePath}`);
      }
      sourceByProjectedName.set(name, image.sourcePath);
    }
    projectedBySource.set(image.sourcePath, destination);
  }
  const changesByLoader = new Map<string, string[]>();
  for (const link of sourceAccess.links) {
    const loader = projectedBySource.get(link.loaderPath);
    if (!loader) throw new Error(`review evidence runtime projection omitted loader: ${link.loaderPath}`);
    const projectedInstallName = link.targetIsSystem
      ? link.resolvedPath
      : `@loader_path/${basename(projectedBySource.get(link.resolvedPath) ?? '')}`;
    if (projectedInstallName.endsWith('/')) {
      throw new Error(`review evidence runtime projection omitted library: ${link.resolvedPath}`);
    }
    if (projectedInstallName !== link.installName) {
      const changes = changesByLoader.get(loader) ?? [];
      changes.push('-change', link.installName, projectedInstallName);
      changesByLoader.set(loader, changes);
    }
  }
  for (const [loader, changes] of changesByLoader) {
    runRuntimeProjectionTool('/usr/bin/install_name_tool', [...changes, loader]);
  }
  const projectedCommand = projectedBySource.get(executableSource);
  if (!projectedCommand) throw new Error('review evidence runtime projection omitted executable');
  const projectedImages = uniqueSorted([...projectedBySource.values()]);
  const signingOrder = [
    ...projectedImages.filter((entry) => entry !== projectedCommand),
    projectedCommand,
  ];
  runRuntimeProjectionTool('/usr/bin/codesign', [
    '--force', '--sign', '-', '--timestamp=none', ...signingOrder,
  ]);
  for (const image of projectedImages) {
    chmodSync(image, image === projectedCommand ? 0o555 : 0o444);
  }
  const toolIdentityDigest = sha256(stableJson({
    installNameTool: runtimeImageContentDigest('/usr/bin/install_name_tool'),
    codesign: runtimeImageContentDigest('/usr/bin/codesign'),
  }));
  const projectionIdentity = () => runtimeProjectionIdentityDigest(
    realRuntimeBin,
    sourceAccess.identityDigest,
    toolIdentityDigest,
  );
  const identityDigest = projectionIdentity();
  return {
    command: projectedCommand,
    access: {
      roots: [...sourceAccess.roots, realRuntimeBin],
      literals: [],
      mapExecutableRoots: [realRuntimeBin],
      mapExecutableLiterals: [],
      images: [],
      links: [],
      missingWeakLinks: [],
      identityDigest,
    },
    identityDigest,
    environment: {
      PATH: `${realRuntimeBin}:/usr/bin:/bin`,
      OPENSSL_CONF: '/dev/null',
    },
    verifyUnchanged: () => {
      try {
        return projectionIdentity() === identityDigest;
      } catch {
        return false;
      }
    },
  };
}

function runRuntimeProjectionTool(command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`review evidence runtime projection tool failed: ${basename(command)}: ${boundText(
      `${result.stdout}\n${result.stderr}`.trim(),
      4096,
    )}`);
  }
}

function runtimeProjectionIdentityDigest(
  runtimeBin: string,
  sourceIdentityDigest: string,
  toolIdentityDigest: string,
): string {
  const entries = readdirSync(runtimeBin, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new Error(`review evidence runtime projection contains invalid entry: ${entry.name}`);
      }
      const file = join(runtimeBin, entry.name);
      const stat = lstatSync(file);
      return {
        name: entry.name,
        mode: stat.mode & 0o777,
        size: stat.size,
        contentDigest: runtimeImageContentDigest(file),
      };
    });
  return sha256(stableJson({
    sourceIdentityDigest,
    toolIdentityDigest,
    environment: { OPENSSL_CONF: '/dev/null' },
    entries,
  }));
}

async function runEvidenceOperation(
  provider: EvidenceProvider,
  operation: EvidenceOperation,
  cwd: string,
  binding: CandidateBinding,
  dependencyDigest: string,
  changedFiles: string[],
  runnerRoot: string,
  runtimeProjectionRoot: string,
  preparedRuntimes: Map<string, PreparedEvidenceRuntime>,
): Promise<ReviewEvidenceRecord> {
  const startedAt = new Date().toISOString();
  const replayCommand = operation.argv.map((value) =>
    value.replaceAll('{seed}', operation.seed ?? ''));
  const command = resolveExecutable(replayCommand[0]!);
  const runtimeAccess = evidenceRuntimeReadAccess(command);
  const systemToolAccess = evidenceSystemToolAccess(operation.requiredSystemTools);
  const preparedRuntimeKey = sha256(stableJson({
    command,
    sourceRuntimeDigest: runtimeAccess.identityDigest,
    runnerPolicy: EVIDENCE_RUNNER_POLICY,
  }));
  let preparedRuntime = preparedRuntimes.get(preparedRuntimeKey);
  if (!preparedRuntime) {
    preparedRuntime = prepareEvidenceRuntime(
      command,
      join(runtimeProjectionRoot, preparedRuntimeKey),
      runtimeAccess,
    );
    preparedRuntimes.set(preparedRuntimeKey, preparedRuntime);
  }
  const preparedChildRuntimes = operation.requiredSystemTools
    .filter((tool) => tool !== 'git')
    .map((tool) => {
      const childCommand = resolveExecutable(tool);
      const childSourceAccess = evidenceRuntimeReadAccess(childCommand);
      const key = sha256(stableJson({
        command: childCommand,
        sourceRuntimeDigest: childSourceAccess.identityDigest,
        runnerPolicy: EVIDENCE_RUNNER_POLICY,
      }));
      let prepared = preparedRuntimes.get(key);
      if (!prepared) {
        prepared = prepareEvidenceRuntime(
          childCommand,
          join(runtimeProjectionRoot, key),
          childSourceAccess,
        );
        preparedRuntimes.set(key, prepared);
      }
      return { tool, command: childCommand, sourceAccess: childSourceAccess, prepared };
    });
  const sandboxRuntimeAccess = mergeEvidenceRuntimeReadAccess([
    preparedRuntime.access,
    ...preparedChildRuntimes.map((entry) => entry.prepared.access),
  ]);
  const executionIdentityDigest = sha256(stableJson({
    executableDigest: executableContentDigest(command),
    sourceRuntimeDigest: runtimeAccess.identityDigest,
    executionRuntimeDigest: preparedRuntime.identityDigest,
    childRuntimeDigests: preparedChildRuntimes.map((entry) => ({
      tool: entry.tool,
      source: entry.sourceAccess.identityDigest,
      execution: entry.prepared.identityDigest,
    })),
    dependencyProjectionDigest: dependencyDigest,
    systemToolDigest: systemToolAccess.identityDigest,
    runnerPolicy: EVIDENCE_RUNNER_POLICY,
    platform: process.platform,
    architecture: process.arch,
  }));
  const commandDigest = sha256(stableJson({
    argv: operation.argv,
    cwd: '.',
    network: operation.network,
    target: operation.target,
    expectedExit: operation.expectedExit,
    expectedExitCode: operation.expectedExitCode,
    evidenceLevel: operation.evidenceLevel,
    seed: operation.seed,
    iterations: operation.iterations,
  }));
  const runnerTmpPath = join(runnerRoot, 'tmp');
  const runnerHomePath = join(runnerRoot, 'home');
  mkdirSync(runnerTmpPath, { recursive: true });
  mkdirSync(runnerHomePath, { recursive: true });
  const runnerTmp = realpathSync(runnerTmpPath);
  const runnerHome = realpathSync(runnerHomePath);
  const env = {
    PATH: uniqueSorted([
      dirname(preparedRuntime.command),
      ...preparedChildRuntimes.map((entry) => dirname(entry.prepared.command)),
    ]).join(':') + ':/usr/bin:/bin',
    HOME: runnerHome,
    TMPDIR: runnerTmp,
    TMP: runnerTmp,
    TEMP: runnerTmp,
    LANG: process.env.LANG ?? 'C.UTF-8',
    LC_ALL: process.env.LC_ALL ?? '',
    GOLDBAND_EVIDENCE_SEED: operation.seed ?? '',
    GOLDBAND_EVIDENCE_ITERATIONS: operation.iterations ? String(operation.iterations) : '',
    GOLDBAND_EVIDENCE_NETWORK: operation.network,
    [EVIDENCE_SANDBOX_ACTIVE_ENV]: '1',
    [EVIDENCE_TEMP_ROOT_ENV]: runnerTmp,
    CI: '1',
    OPENSSL_CONF: preparedRuntime.environment.OPENSSL_CONF ?? '/dev/null',
  };
  const sandbox = evidenceSandboxCommand(
    cwd,
    [runnerTmp, runnerHome],
    [preparedRuntime.command, ...replayCommand.slice(1)],
    sandboxRuntimeAccess,
    systemToolAccess.roots,
    systemToolAccess.literals,
    systemToolAccess.mapExecutableLiterals,
  );
  const ignoredDependencies = dependencyRelativePaths(changedFiles);
  const snapshotDigestBefore = snapshotContentDigest(cwd, ignoredDependencies);
  const stdoutHash = createHash('sha256');
  const stderrHash = createHash('sha256');
  let stderrDiagnosticHead = '';
  let result: {
    reason: string;
    exitCode: number;
    stdout?: string;
    stderr?: string;
  };
  result = await superviseCommand(sandbox.command, sandbox.args, {
      cwd,
      env,
      timeoutMs: operation.timeoutMs,
      killGraceMs: 1000,
      killConfirmMs: 2000,
      captureOutput: {
        stdoutMaxBytes: operation.maxOutputBytes,
        stderrMaxBytes: operation.maxOutputBytes,
      },
      label: `review evidence ${provider.id}:${operation.id}`,
      stdout: { write(chunk: string) { stdoutHash.update(chunk); } },
      stderr: {
        write(chunk: string) {
          stderrHash.update(chunk);
          const remaining = MAX_EVIDENCE_RUNTIME_DIAGNOSTIC_CHARS - stderrDiagnosticHead.length;
          if (remaining > 0) stderrDiagnosticHead += chunk.slice(0, remaining);
        },
      },
  });
  const finishedAt = new Date().toISOString();
  const snapshotDigestAfter = snapshotContentDigest(cwd, ignoredDependencies);
  const snapshotUnchanged = snapshotDigestBefore === snapshotDigestAfter;
  let runtimeUnchanged = false;
  try {
    runtimeUnchanged = evidenceRuntimeReadAccess(command).identityDigest === runtimeAccess.identityDigest &&
      systemToolAccess.verifyUnchanged() &&
      preparedRuntime.verifyUnchanged() &&
      preparedChildRuntimes.every((entry) =>
        evidenceRuntimeReadAccess(entry.command).identityDigest === entry.sourceAccess.identityDigest &&
        entry.prepared.verifyUnchanged());
  } catch {
    runtimeUnchanged = false;
  }
  const combined = [result.stdout ?? '', result.stderr ?? ''].filter(Boolean).join('\n');
  const outputSummary = boundText(combined, operation.maxOutputBytes);
  const sandboxDenied = isEvidenceSandboxRuntimeFailure(sandbox.command, {
    reason: result.reason,
    exitCode: result.exitCode,
    stderr: stderrDiagnosticHead,
  }, sandbox.brokered);
  let status: EvidenceRecordStatus;
  const exitStatus = result.reason === 'exit' ? result.exitCode : undefined;
  if (result.reason !== 'exit') {
    status = 'runtime-incomplete';
  } else if (!snapshotUnchanged || !runtimeUnchanged || sandboxDenied) {
    status = 'runtime-incomplete';
  } else {
    const matched = operation.expectedExit === 'zero'
      ? result.exitCode === 0
      : result.exitCode === operation.expectedExitCode;
    status = matched ? 'verified-pass' : 'verified-failure';
  }
  const errorText = result.reason !== 'exit'
    ? `runner incomplete: ${result.reason}`
    : !snapshotUnchanged
      ? 'runner incomplete: evidence operation mutated its isolated candidate snapshot'
      : !runtimeUnchanged
        ? 'runner incomplete: executable runtime libraries changed during evidence execution'
      : sandboxDenied
        ? 'runner incomplete: sandbox-exec denied or could not initialize the operation'
        : '';
  const summary = boundText([outputSummary, errorText].filter(Boolean).join('\n'), operation.maxOutputBytes);
  return {
    id: `${provider.id}:${operation.id}`,
    providerId: provider.id,
    operationId: operation.id,
    cellIds: [...provider.cellIds],
    owner: provider.owner,
    kind: provider.kind,
    status,
    evidenceLevel: operation.evidenceLevel,
    environment: `isolated-${process.platform}-snapshot`,
    commandDigest,
    executionIdentityDigest,
    snapshotDigestBefore,
    snapshotDigestAfter,
    replayCommand,
    seed: operation.seed,
    iterations: operation.iterations,
    startedAt,
    finishedAt,
    exitStatus,
    outputDigest: sha256(`${stdoutHash.digest('hex')}:${stderrHash.digest('hex')}`),
    outputSummary: summary,
    candidateDigest: binding.candidateDigest,
    baseDigest: binding.baseDigest,
    scopeDigest: binding.scopeDigest,
    fresh: snapshotUnchanged && runtimeUnchanged && status !== 'runtime-incomplete',
  };
}

function evidenceSandboxCommand(
  cwd: string,
  writableRoots: string[],
  argv: string[],
  runtimeAccess: EvidenceRuntimeReadAccess,
  systemToolRoots: string[] = [],
  systemToolLiterals: string[] = [],
  systemToolMapExecutableLiterals: string[] = [],
): { command: string; args: string[]; brokered: boolean } {
  if (process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec')) {
    const readableCwd = realpathSync(cwd);
    const realWritableRoots = writableRoots.map((root) => realpathSync(root));
    const allowedWrites = realWritableRoots.map((root) =>
      `(allow file-write* (subpath ${JSON.stringify(root)}))`);
    const allowedWritableRootLiterals = realWritableRoots.flatMap((root) => [
      `(allow file-read* (literal ${JSON.stringify(root)}))`,
      `(allow file-read-metadata file-test-existence (literal ${JSON.stringify(root)}))`,
    ]);
    const allowedReads = uniqueSorted([
      readableCwd,
      ...realWritableRoots,
      ...runtimeAccess.roots,
      ...systemToolRoots,
    ]).map((root) => `(allow file-read* (subpath ${JSON.stringify(root)}))`);
    const allowedReadMetadata = uniqueSorted([
      readableCwd,
      ...realWritableRoots,
      ...runtimeAccess.roots,
      ...systemToolRoots,
    ]).map((root) =>
      `(allow file-read-metadata file-test-existence (path-ancestors ${JSON.stringify(root)}))`);
    // Bun and script launchers open ancestor directories while changing from
    // the operation cwd into an authorized runtime root. Permit traversal of
    // those directories without granting reads of sibling file contents.
    const allowedAncestorDirectories = uniqueSorted([
      readableCwd,
      ...runtimeAccess.roots,
      ...systemToolRoots,
    ]).flatMap((root) => [
      `(allow file-read-data (literal ${JSON.stringify(root)}))`,
      `(allow file-read-data (path-ancestors ${JSON.stringify(root)}))`,
    ]);
    const runtimeLiteralReads = uniqueSorted([...runtimeAccess.literals, ...systemToolLiterals])
      .map((file) => `(allow file-read* (literal ${JSON.stringify(file)}))`);
    const runtimeExecutableMaps = uniqueSorted([
      ...runtimeAccess.mapExecutableLiterals,
      ...systemToolMapExecutableLiterals,
    ])
      .map((file) => `(allow file-map-executable (literal ${JSON.stringify(file)}))`);
    const runtimeExecutableMapRoots = uniqueSorted(runtimeAccess.mapExecutableRoots)
      .map((root) => `(allow file-map-executable (subpath ${JSON.stringify(root)}))`);
    const systemToolExecutableMapRoots = uniqueSorted(systemToolRoots)
      .map((root) => `(allow file-map-executable (subpath ${JSON.stringify(root)}))`);
    const runtimeLiteralMetadata = uniqueSorted([...runtimeAccess.literals, ...systemToolLiterals])
      .map((file) =>
        `(allow file-read-metadata file-test-existence (path-ancestors ${JSON.stringify(file)}))`);
    const deniedSystemMachServices = SYSTEM_SANDBOX_MACH_SERVICES
      .map((name) => `(global-name ${JSON.stringify(name)})`);
    const profile = [
      '(version 1)',
      '(deny default)',
      '(import "system.sb")',
      '(deny network*)',
      '(deny network-outbound (literal "/private/var/run/syslog"))',
      '(deny mach-lookup)',
      `(deny mach-lookup ${deniedSystemMachServices.join(' ')} (local-name "com.apple.cfprefsd.agent"))`,
      `(if (defined? 'system-socket) (deny system-socket))`,
      '(deny ipc-posix-shm-read* (ipc-posix-name "apple.shm.notification_center") (ipc-posix-name-prefix "apple.cfprefs."))',
      '(allow process-exec)',
      '(allow process-fork)',
      '(allow signal (target self))',
      '(allow signal (target children))',
      '(allow sysctl-read)',
      '(allow file-read* (literal "/dev/null"))',
      '(allow file-write* (literal "/dev/null"))',
      `(allow file-read* (literal ${JSON.stringify(argv[0])}))`,
      ...runtimeLiteralMetadata,
      ...runtimeLiteralReads,
      ...runtimeExecutableMaps,
      ...runtimeExecutableMapRoots,
      ...systemToolExecutableMapRoots,
      ...allowedAncestorDirectories,
      ...allowedReadMetadata,
      ...allowedReads,
      ...allowedWritableRootLiterals,
      ...allowedWrites,
    ].join(' ');
    return {
      command: '/usr/bin/sandbox-exec',
      args: ['-p', profile, '--', ...argv],
      brokered: false,
    };
  }
  throw new Error('review evidence runner requires a supported OS network/filesystem sandbox');
}

export type EvidenceRuntimeReadAccess = {
  roots: string[];
  literals: string[];
  mapExecutableRoots: string[];
  mapExecutableLiterals: string[];
  images: Array<{ sourcePath: string; contentDigest: string }>;
  links: Array<{
    loaderPath: string;
    installName: string;
    resolvedPath: string;
    targetIsSystem: boolean;
  }>;
  missingWeakLinks: Array<{ loaderPath: string; installName: string }>;
  identityDigest: string;
};

function mergeEvidenceRuntimeReadAccess(
  accesses: EvidenceRuntimeReadAccess[],
): EvidenceRuntimeReadAccess {
  return {
    roots: uniqueSorted(accesses.flatMap((access) => access.roots)),
    literals: uniqueSorted(accesses.flatMap((access) => access.literals)),
    mapExecutableRoots: uniqueSorted(accesses.flatMap((access) => access.mapExecutableRoots)),
    mapExecutableLiterals: uniqueSorted(accesses.flatMap((access) => access.mapExecutableLiterals)),
    images: [],
    links: [],
    missingWeakLinks: [],
    identityDigest: sha256(stableJson(accesses.map((access) => access.identityDigest))),
  };
}

export function evidenceRuntimeReadAccess(executable: string): EvidenceRuntimeReadAccess {
  const roots = [
    '/System/Library',
    '/usr/lib',
    '/private/var/db/dyld',
  ].filter(existsSync);
  const executableFile = realpathSync(executable);
  const literals = uniqueSorted([
    executable,
    executableFile,
    ...pathSymlinkLiterals(executable),
  ]);
  const mapExecutableLiterals = [executableFile];
  const images = [{
    sourcePath: executableFile,
    contentDigest: runtimeImageContentDigest(executableFile),
  }];
  const links: EvidenceRuntimeReadAccess['links'] = [];
  const missingWeakLinks: EvidenceRuntimeReadAccess['missingWeakLinks'] = [];
  const attestations = [{
    installPath: executable,
    resolvedPath: executableFile,
    contentDigest: images[0]!.contentDigest,
  }];
  if (process.platform === 'darwin' && existsSync('/usr/bin/otool')) {
    const systemRoots = roots.map((root) => realpathSync(root));
    const visited = new Set<string>();
    const loadedRpathImages = new Map<string, string>();
    const visitImage = (image: string, inheritedRpaths: string[]): void => {
      if (visited.has(image)) return;
      visited.add(image);
      const rpaths = uniqueInOrder([
        ...machORpaths(image, executableFile),
        ...inheritedRpaths,
      ]);
      const dependencies: Array<{ image: string; inheritedRpaths: string[] }> = [];
      for (const edge of machOLoadedDylibs(image)) {
        const { installName } = edge;
        if (isAbsolute(installName) && systemRoots.some((root) =>
          installName === root || installName.startsWith(`${root}${sep}`))) continue;
        const previouslyLoaded = installName.startsWith('@rpath/')
          ? loadedRpathImages.get(installName)
          : undefined;
        const library = previouslyLoaded ??
          resolveMachOInstallName(installName, image, executableFile, rpaths);
        if (!library) {
          if (edge.weak) {
            missingWeakLinks.push({ loaderPath: image, installName });
            continue;
          }
          throw new Error(
            `review evidence cannot resolve executable library ${installName} from ${image}`,
          );
        }
        const libraryPath = resolve(library);
        const resolvedLibrary = realpathSync(libraryPath);
        if (installName.startsWith('@rpath/') && !previouslyLoaded) {
          loadedRpathImages.set(installName, resolvedLibrary);
        }
        const resolvedLibraryIsSystem = systemRoots.some((root) =>
          resolvedLibrary === root || resolvedLibrary.startsWith(`${root}${sep}`));
        links.push({
          loaderPath: image,
          installName,
          resolvedPath: resolvedLibrary,
          targetIsSystem: resolvedLibraryIsSystem,
        });
        const contentDigest = runtimeImageContentDigest(resolvedLibrary);
        attestations.push({
          installPath: libraryPath,
          resolvedPath: resolvedLibrary,
          contentDigest,
        });
        literals.push(...runtimeLibraryLiteralPaths(libraryPath, resolvedLibrary, systemRoots));
        mapExecutableLiterals.push(
          libraryPath,
          ...(resolvedLibraryIsSystem ? [] : [resolvedLibrary]),
        );
        if (resolvedLibraryIsSystem) continue;
        if (!images.some((entry) => entry.sourcePath === resolvedLibrary)) {
          images.push({
            sourcePath: resolvedLibrary,
            contentDigest,
          });
        }
        dependencies.push({ image: resolvedLibrary, inheritedRpaths: rpaths });
      }
      for (const dependency of dependencies) {
        visitImage(dependency.image, dependency.inheritedRpaths);
      }
    };
    visitImage(executableFile, []);
  }
  return {
    roots: roots.map((root) => realpathSync(root)),
    literals: uniqueSorted(literals),
    mapExecutableRoots: [],
    mapExecutableLiterals: uniqueSorted(mapExecutableLiterals),
    images: images.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath)),
    links: links.sort((left, right) =>
      `${left.loaderPath}\0${left.installName}`.localeCompare(`${right.loaderPath}\0${right.installName}`)),
    missingWeakLinks: missingWeakLinks.sort((left, right) =>
      `${left.loaderPath}\0${left.installName}`.localeCompare(`${right.loaderPath}\0${right.installName}`)),
    identityDigest: sha256(stableJson({
      attestations: attestations.sort((left, right) =>
        `${left.installPath}\0${left.resolvedPath}`.localeCompare(`${right.installPath}\0${right.resolvedPath}`)),
      links,
      missingWeakLinks,
    })),
  };
}

export function isEvidenceSandboxRuntimeFailure(
  sandboxCommand: string,
  result: { reason: string; exitCode: number; stderr?: string },
  brokered = false,
): boolean {
  if ((!brokered && sandboxCommand !== '/usr/bin/sandbox-exec') || result.reason !== 'exit') return false;
  const stderr = result.stderr ?? '';
  const brokerFailed = brokered && result.exitCode === 71 &&
    /^evidence sandbox broker (?:rejected request|timed out|response)/im.test(stderr);
  const sandboxInitializationFailed = result.exitCode === 71 &&
    /^(?:sandbox-exec:|sandbox_init:)/im.test(stderr);
  const dynamicLoaderFailedBeforeMain = result.exitCode !== 0 &&
    /^dyld\[\d+\]:/m.test(stderr);
  return brokerFailed || sandboxInitializationFailed || dynamicLoaderFailedBeforeMain;
}

export function runtimeLibraryLiteralPaths(
  libraryPath: string,
  resolvedLibrary: string,
  systemRoots: string[],
): string[] {
  const targetIsSystem = systemRoots.some((root) =>
    resolvedLibrary === root || resolvedLibrary.startsWith(`${root}${sep}`));
  return uniqueSorted([
    libraryPath,
    ...pathSymlinkLiterals(libraryPath),
    ...(targetIsSystem ? [] : [resolvedLibrary]),
  ]);
}

function pathSymlinkLiterals(file: string): string[] {
  const absolute = resolve(file);
  const parts = absolute.split(sep).filter(Boolean);
  const symlinks: string[] = [];
  let current: string = sep;
  for (const part of parts) {
    current = join(current, part);
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) symlinks.push(current);
  }
  return symlinks;
}

export function runtimeImageContentDigest(file: string): string {
  const expected = lstatSync(file);
  if (!expected.isFile() || expected.isSymbolicLink()) {
    throw new Error(`review evidence runtime image is not a regular file: ${file}`);
  }
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(fd);
    if (!sameFileSnapshot(opened, expected)) {
      throw new Error(`review evidence runtime image changed while opening: ${file}`);
    }
    const hash = createHash('sha256');
    const chunk = Buffer.allocUnsafe(64 * 1024);
    while (true) {
      const bytesRead = readSync(fd, chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      hash.update(chunk.subarray(0, bytesRead));
    }
    if (!sameFileSnapshot(fstatSync(fd), opened)) {
      throw new Error(`review evidence runtime image changed while reading: ${file}`);
    }
    return hash.digest('hex');
  } finally {
    closeSync(fd);
  }
}

function otool(image: string, mode: '-L' | '-l'): string {
  const result = spawnSync('/usr/bin/otool', [mode, image], {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `review evidence executable must be a Mach-O binary; invoke an interpreter explicitly instead of a script launcher: ${image}`,
    );
  }
  if (/is not an object file/i.test(`${result.stdout}\n${result.stderr}`)) {
    throw new Error(
      `review evidence executable must be a Mach-O binary; invoke an interpreter explicitly instead of a script launcher: ${image}`,
    );
  }
  return result.stdout;
}

function machORpaths(image: string, executable: string): string[] {
  const loadCommands = otool(image, '-l').split('\n');
  const rpaths: string[] = [];
  for (let index = 0; index < loadCommands.length; index += 1) {
    if (loadCommands[index]?.trim() !== 'cmd LC_RPATH') continue;
    for (let cursor = index + 1; cursor < Math.min(index + 8, loadCommands.length); cursor += 1) {
      const match = loadCommands[cursor]?.trim().match(/^path (.+) \(offset \d+\)$/);
      if (!match) continue;
      const expanded = expandMachOPath(match[1]!, image, executable);
      if (expanded) rpaths.push(expanded);
      break;
    }
  }
  return uniqueInOrder(rpaths);
}

function machOLoadedDylibs(image: string): Array<{ installName: string; weak: boolean }> {
  const loadCommands = otool(image, '-l').split('\n');
  const installNames: Array<{ installName: string; weak: boolean }> = [];
  const dependencyCommands = new Set([
    'LC_LOAD_DYLIB',
    'LC_LOAD_WEAK_DYLIB',
    'LC_REEXPORT_DYLIB',
    'LC_LOAD_UPWARD_DYLIB',
  ]);
  for (let index = 0; index < loadCommands.length; index += 1) {
    const command = loadCommands[index]?.trim().match(/^cmd (LC_[A-Z_]+)$/)?.[1];
    if (!command || !dependencyCommands.has(command)) continue;
    for (let cursor = index + 1; cursor < Math.min(index + 8, loadCommands.length); cursor += 1) {
      const match = loadCommands[cursor]?.trim().match(/^name (.+) \(offset \d+\)$/);
      if (!match) continue;
      installNames.push({
        installName: match[1]!,
        weak: command === 'LC_LOAD_WEAK_DYLIB',
      });
      break;
    }
  }
  return installNames;
}

function resolveMachOInstallName(
  installName: string,
  loader: string,
  executable: string,
  rpaths: string[],
): string | undefined {
  if (installName.startsWith('@rpath/')) {
    const suffix = installName.slice('@rpath/'.length);
    for (const root of rpaths) {
      const candidate = resolve(root, suffix);
      if (existsSync(candidate)) return candidate;
    }
    return undefined;
  }
  const expanded = expandMachOPath(installName, loader, executable);
  return expanded && existsSync(expanded) ? expanded : undefined;
}

function expandMachOPath(
  value: string,
  loader: string,
  executable: string,
): string | undefined {
  if (isAbsolute(value)) return value;
  if (value === '@loader_path') return dirname(loader);
  if (value.startsWith('@loader_path/')) {
    return resolve(dirname(loader), value.slice('@loader_path/'.length));
  }
  if (value === '@executable_path') return dirname(executable);
  if (value.startsWith('@executable_path/')) {
    return resolve(dirname(executable), value.slice('@executable_path/'.length));
  }
  return undefined;
}

function materializeCandidate(source: string, target: string): void {
  mkdirSync(target, { recursive: true });
  const result = process.platform === 'darwin'
    ? spawnSync('cp', ['-cR', `${source}${sep}.`, target], { encoding: 'utf8' })
    : spawnSync('cp', ['-a', '--reflink=auto', `${source}${sep}.`, target], { encoding: 'utf8' });
  if (result.status === 0) return;
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true, dereference: false });
}

function materializeBase(
  repo: string,
  baseRoot: string,
  changedFiles: string[],
  baseRef: string,
): void {
  resetSnapshotToRef(repo, baseRoot, baseRef);
}

function materializeExactCandidate(
  ctx: WorkflowContext,
  input: ReviewDiffInput,
  candidateRoot: string,
  baseRef: string,
  expectedRedactedUntracked: CandidateBinding['redactedUntrackedFiles'],
): void {
  if (
    input.diff.startsWith('ANALYSIS_ARTIFACT_START ')
  ) {
    materializeCandidate(ctx.cwd, candidateRoot);
    return;
  }
  resetSnapshotToRef(ctx.cwd, candidateRoot, baseRef);
  if (!input.diff.trim()) {
    return;
  }
  const applicableDiff = input.diff
    .split(/(?=^diff --git )/m)
    .filter((section) => !isSyntheticSkippedUntrackedSection(section))
    .join('');
  if (applicableDiff.trim()) {
    const applied = spawnSync(
      'git',
      ['apply', '--whitespace=nowarn', '-'],
      {
        cwd: candidateRoot,
        input: applicableDiff,
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    if (applied.status !== 0) {
      throw new Error(`review evidence could not materialize the exact candidate patch: ${applied.stderr}`);
    }
  }
  materializeRedactedUntrackedFiles(
    ctx.cwd,
    candidateRoot,
    input.diff,
    expectedRedactedUntracked,
  );
}

function isSyntheticSkippedUntrackedSection(section: string): boolean {
  const lines = section.trimEnd().split('\n');
  return lines.length === 6 &&
    lines[0]!.startsWith('diff --git ') &&
    lines[1] === 'new file mode 100644' &&
    lines[2] === '--- /dev/null' &&
    lines[3]!.startsWith('+++ ') &&
    lines[4] === '@@ -0,0 +1,1 @@' &&
    /^\+\[\[review\/code skipped untracked file: .+\]\]$/.test(lines[5]!);
}

function hiddenUntrackedCandidateProjection(
  repo: string,
  diff: string,
): CandidateBinding['redactedUntrackedFiles'] {
  return skippedUntrackedSections(diff).map(({ path }) => {
    const { content, mode } = readBoundedRedactedUntrackedFile(repo, path);
    return { path, digest: sha256(content), size: content.length, mode };
  }).sort((left, right) => left.path.localeCompare(right.path));
}

function materializeRedactedUntrackedFiles(
  repo: string,
  target: string,
  diff: string,
  expected: CandidateBinding['redactedUntrackedFiles'],
): void {
  const expectedByPath = new Map(expected.map((entry) => [entry.path, entry]));
  const observedPaths = skippedUntrackedSections(diff).map((entry) => entry.path).sort();
  if (stableJson(observedPaths) !== stableJson([...expectedByPath.keys()].sort())) {
    throw new Error('review evidence redacted untracked projection does not match candidate diff');
  }
  for (const { path } of skippedUntrackedSections(diff)) {
    const { content, mode } = readBoundedRedactedUntrackedFile(repo, path);
    const observed = { path, digest: sha256(content), size: content.length, mode };
    if (stableJson(observed) !== stableJson(expectedByPath.get(path))) {
      throw new Error(`review evidence redacted untracked file changed after candidate binding: ${path}`);
    }
    const destination = resolveWithin(target, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content, { mode: mode === '100755' ? 0o755 : 0o644, flag: 'wx' });
  }
}

function readBoundedRedactedUntrackedFile(
  repo: string,
  path: string,
): { content: Buffer; mode: '100644' | '100755' } {
  const source = resolveWithin(repo, path);
  const repositoryRoot = realpathSync(repo);
  const expected = lstatSync(source, { throwIfNoEntry: false });
  if (!expected?.isFile() || expected.isSymbolicLink() || expected.size > MAX_REDACTED_UNTRACKED_BYTES) {
    throw new Error(`review evidence cannot safely read redacted untracked file: ${path}`);
  }
  const realSource = realpathSync(source);
  if (realSource !== repositoryRoot && !realSource.startsWith(`${repositoryRoot}${sep}`)) {
    throw new Error(`review evidence redacted untracked file escapes repository: ${path}`);
  }
  const fd = openSync(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const opened = fstatSync(fd);
    if (!sameFileSnapshot(opened, expected)) {
      throw new Error(`review evidence redacted untracked file changed while opening: ${path}`);
    }
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, (MAX_REDACTED_UNTRACKED_BYTES + 1) - total));
      const bytesRead = readSync(fd, chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > MAX_REDACTED_UNTRACKED_BYTES) {
        throw new Error(`review evidence redacted untracked file exceeds byte limit: ${path}`);
      }
      chunks.push(chunk.subarray(0, bytesRead));
    }
    if (!sameFileSnapshot(fstatSync(fd), opened)) {
      throw new Error(`review evidence redacted untracked file changed while reading: ${path}`);
    }
    return {
      content: Buffer.concat(chunks, total),
      mode: (opened.mode & 0o111) !== 0 ? '100755' : '100644',
    };
  } finally {
    closeSync(fd);
  }
}

function sameFileSnapshot(left: ReturnType<typeof fstatSync>, right: ReturnType<typeof fstatSync>): boolean {
  return left.isFile() && right.isFile() && left.dev === right.dev && left.ino === right.ino &&
    left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function skippedUntrackedSections(diff: string): Array<{ path: string; reason: string }> {
  return diff
    .split(/(?=^diff --git )/m)
    .filter(isSyntheticSkippedUntrackedSection)
    .map((section) => {
      const lines = section.trimEnd().split('\n');
      const path = decodePatchHeaderPath(lines[3]!.slice(4));
      const match = /^\+\[\[review\/code skipped untracked file: (.+)\]\]$/.exec(lines[5]!);
      if (!path || !match) throw new Error('invalid redacted untracked diff section');
      return { path, reason: match[1]! };
    });
}

function decodePatchHeaderPath(raw: string): string | undefined {
  const token = raw.startsWith('"')
    ? decodeGitQuotedPath(raw)
    : raw.split('\t', 1)[0];
  if (!token || token === '/dev/null') return undefined;
  return token.startsWith('a/') || token.startsWith('b/') ? token.slice(2) : token;
}

function decodeGitQuotedPath(raw: string): string {
  const bytes: number[] = [];
  for (let index = 1; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === '"') break;
    if (char !== '\\') {
      bytes.push(...Buffer.from(char));
      continue;
    }
    const escape = raw[++index];
    if (escape === undefined) break;
    const simple = new Map<string, number>([
      ['a', 0x07], ['b', 0x08], ['t', 0x09], ['n', 0x0a],
      ['v', 0x0b], ['f', 0x0c], ['r', 0x0d], ['\\', 0x5c], ['"', 0x22],
    ]);
    const decoded = simple.get(escape);
    if (decoded !== undefined) {
      bytes.push(decoded);
      continue;
    }
    if (/[0-7]/.test(escape)) {
      let octal = escape;
      while (octal.length < 3 && /[0-7]/.test(raw[index + 1] ?? '')) octal += raw[++index];
      bytes.push(Number.parseInt(octal, 8));
      continue;
    }
    bytes.push(...Buffer.from(escape));
  }
  return Buffer.from(bytes).toString('utf8');
}

function operationNeedsDependencies(operation: EvidenceOperation): boolean {
  return !['true', 'false'].includes(operation.argv[0]!);
}

function resetSnapshotToRef(
  repo: string,
  snapshotRoot: string,
  baseRef: string,
): void {
  rmSync(snapshotRoot, { recursive: true, force: true });
  mkdirSync(snapshotRoot, { recursive: true });
  const repositoryRoot = gitOutput(repo, ['rev-parse', '--show-toplevel']);
  const repositorySubdirectory = relative(repositoryRoot, realpathSync(repo)).replaceAll('\\', '/');
  if (!gitOutput(repositoryRoot, ['rev-parse', '--verify', baseRef], true)) return;
  const archive = spawnSync(
    'git',
    ['archive', '--format=tar', baseRef, ...(repositorySubdirectory ? [repositorySubdirectory] : [])],
    {
    cwd: repositoryRoot,
    maxBuffer: 256 * 1024 * 1024,
    },
  );
  if (archive.status !== 0 || !archive.stdout) {
    throw new Error(`review evidence could not materialize base snapshot: ${String(archive.stderr)}`);
  }
  const stripComponents = repositorySubdirectory
    ? repositorySubdirectory.split('/').filter(Boolean).length
    : 0;
  const tar = spawnSync(
    'tar',
    ['-xf', '-', '-C', snapshotRoot, ...(stripComponents ? [`--strip-components=${stripComponents}`] : [])],
    {
    input: archive.stdout,
    maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (tar.status !== 0) throw new Error(`review evidence could not extract base snapshot: ${String(tar.stderr)}`);
}

function projectDependencyDirectories(
  repo: string,
  snapshotRoot: string,
  changedFiles: string[],
): void {
  for (const relativePath of dependencyRelativePaths(changedFiles)) {
    const source = resolveWithin(repo, relativePath);
    if (!existsSync(source)) continue;
    const target = resolveWithin(snapshotRoot, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    materializeCandidate(source, target);
  }
}

function dependencyRelativePaths(changedFiles: string[]): string[] {
  const candidates = new Set<string>(['node_modules']);
  for (const file of changedFiles) {
    const parts = file.split('/').filter(Boolean);
    for (let index = 1; index < parts.length; index += 1) {
      candidates.add(`${parts.slice(0, index).join('/')}/node_modules`);
    }
  }
  return uniqueSorted([...candidates]);
}

function dispositionRecord(
  cell: BehaviorCell,
  binding: CandidateBinding,
  status: EvidenceRecordStatus,
): ReviewEvidenceRecord {
  const now = new Date().toISOString();
  return {
    id: `cell:${cell.id}:${cell.disposition}`,
    cellIds: [cell.id],
    owner: 'behavior-matrix',
    kind: 'disposition',
    status,
    evidenceLevel: 'fixture',
    environment: 'deterministic-manifest-validation',
    startedAt: now,
    finishedAt: now,
    outputDigest: sha256(cell.reason ?? cell.disposition),
    outputSummary: cell.reason ?? cell.disposition,
    candidateDigest: binding.candidateDigest,
    baseDigest: binding.baseDigest,
    scopeDigest: binding.scopeDigest,
    fresh: true,
  };
}

function providerApplies(provider: EvidenceProvider, changedFiles: string[]): boolean {
  if (provider.changedPathPrefixes.length === 0) return true;
  return changedFiles.some((file) =>
    provider.changedPathPrefixes.some((prefix) => file === prefix || file.startsWith(`${prefix}/`)));
}

function recordAuthorizedForCell(
  record: ReviewEvidenceRecord,
  cell: BehaviorCell,
  manifest: ReviewEvidenceManifest,
): boolean {
  if (!record.cellIds.includes(cell.id)) return false;
  if (record.kind === 'disposition') {
    const dispositionStatus = cell.disposition === 'not-applicable'
      ? 'verified-pass'
      : cell.disposition === 'unsupported' || cell.disposition === 'manual'
        ? 'coverage-gap'
        : undefined;
    return Boolean(dispositionStatus) &&
      record.id === `cell:${cell.id}:${cell.disposition}` &&
      record.owner === 'behavior-matrix' &&
      record.status === dispositionStatus &&
      record.cellIds.length === 1 &&
      !record.providerId &&
      !record.operationId &&
      !record.commandDigest;
  }
  if (!record.providerId || !cell.providerIds.includes(record.providerId)) return false;
  const provider = manifest.providers.find((entry) => entry.id === record.providerId);
  return Boolean(provider?.cellIds.includes(cell.id));
}

function safePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128);
}

function evidenceCellsForFinding(
  finding: ReviewFinding,
  evidence: ReviewEvidenceBundle,
): string[] {
  const ids = new Set(finding.evidenceIds ?? []);
  return uniqueSorted(evidence.records
    .filter((record) => ids.has(record.id))
    .flatMap((record) => record.cellIds));
}

function cellAffectedByPaths(
  cellId: string,
  manifest: ReviewEvidenceManifest,
  changedFiles: string[],
): boolean {
  const providers = manifest.providers.filter((provider) => provider.cellIds.includes(cellId));
  return providers.length === 0 || providers.some((provider) => providerApplies(provider, changedFiles));
}

function changedFilesBetweenPatchTexts(original: string, repaired: string): string[] {
  const originalByFile = patchSections(original);
  const repairedByFile = patchSections(repaired);
  return uniqueSorted([...new Set([...originalByFile.keys(), ...repairedByFile.keys()])]
    .filter((file) => originalByFile.get(file) !== repairedByFile.get(file)));
}

function changedRedactedUntrackedPaths(
  original: CandidateBinding['redactedUntrackedFiles'],
  repaired: CandidateBinding['redactedUntrackedFiles'],
): string[] {
  const originalByPath = new Map(original.map((entry) => [entry.path, entry]));
  const repairedByPath = new Map(repaired.map((entry) => [entry.path, entry]));
  return uniqueSorted([...new Set([...originalByPath.keys(), ...repairedByPath.keys()])]
    .filter((path) => stableJson(originalByPath.get(path)) !== stableJson(repairedByPath.get(path))));
}

function redactedUntrackedRepairDelta(
  original: CandidateBinding['redactedUntrackedFiles'],
  repaired: CandidateBinding['redactedUntrackedFiles'],
): string {
  const originalByPath = new Map(original.map((entry) => [entry.path, entry]));
  const repairedByPath = new Map(repaired.map((entry) => [entry.path, entry]));
  const lines = changedRedactedUntrackedPaths(original, repaired).flatMap((path) => {
    const before = originalByPath.get(path);
    const after = repairedByPath.get(path);
    return [
      `REDACTED_UNTRACKED_DELTA ${JSON.stringify(path)}`,
      `- ${before ? `${before.digest} ${before.size}` : 'absent'}`,
      `+ ${after ? `${after.digest} ${after.size}` : 'absent'}`,
    ];
  });
  return lines.join('\n');
}

function patchSections(diff: string): Map<string, string> {
  const sections = new Map<string, string>();
  let file = '';
  let lines: string[] = [];
  const flush = () => {
    if (!lines.length) return;
    let oldPath: string | undefined;
    let newPath: string | undefined;
    let renamedPath: string | undefined;
    for (const line of lines) {
      if (line.startsWith('@@') || line === 'GIT binary patch') break;
      if (line.startsWith('--- ')) oldPath = decodePatchHeaderPath(line.slice(4));
      if (line.startsWith('+++ ')) newPath = decodePatchHeaderPath(line.slice(4));
      if (line.startsWith('rename to ')) renamedPath = decodeGitExtendedHeaderPath(line.slice(10));
      if (line.startsWith('copy to ')) renamedPath = decodeGitExtendedHeaderPath(line.slice(8));
    }
    const authoritativePath = newPath ?? renamedPath ?? oldPath ?? file;
    if (authoritativePath) sections.set(authoritativePath, lines.join('\n'));
  };
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      flush();
      file = decodeGitDiffHeaderPath(line) ?? line;
      lines = [line];
    } else {
      lines.push(line);
    }
  }
  flush();
  return sections;
}

function decodeGitDiffHeaderPath(line: string): string | undefined {
  const quoted = /^diff --git ((?:"(?:\\.|[^"])*")|\S+) ((?:"(?:\\.|[^"])*")|\S+)$/.exec(line);
  if (quoted) return decodePatchHeaderPath(quoted[2]!);
  const rest = line.slice('diff --git '.length);
  if (!rest.startsWith('a/')) return undefined;
  let offset = 0;
  while (true) {
    const boundary = rest.indexOf(' b/', offset);
    if (boundary < 0) return undefined;
    const oldPath = rest.slice(2, boundary);
    const newPath = rest.slice(boundary + 3);
    if (oldPath === newPath) return newPath;
    offset = boundary + 1;
  }
}

function decodeGitExtendedHeaderPath(raw: string): string | undefined {
  if (!raw) return undefined;
  return raw.startsWith('"') ? decodeGitQuotedPath(raw) : raw;
}

function diffPatchTexts(original: string, repaired: string): string {
  const root = mkdtempSync(join(tmpdir(), 'goldband-review-closure-delta-'));
  try {
    writeFileSync(join(root, 'original.patch'), original);
    writeFileSync(join(root, 'repaired.patch'), repaired);
    const result = spawnSync(
      'git',
      [
        '-c', 'diff.external=',
        'diff', '--no-index', '--no-ext-diff', '--no-textconv', '--unified=0',
        '--src-prefix=original/', '--dst-prefix=repaired/', '--',
        'original.patch', 'repaired.patch',
      ],
      { cwd: root, encoding: 'utf8', maxBuffer: MAX_REVIEW_CLOSURE_DELTA_BYTES * 2 },
    );
    if (result.status !== 0 && result.status !== 1) {
      throw new Error(`review closure could not calculate repair delta: ${result.stderr}`);
    }
    return result.stdout;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function canonicalRepository(cwd: string): string {
  const root = gitOutput(cwd, ['rev-parse', '--show-toplevel'], true);
  return realpathSync(root || cwd);
}

function gitOutput(cwd: string, args: string[], allowFailure = false): string {
  const result = spawnSync('git', ['--no-pager', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1' },
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) {
    if (allowFailure) return '';
    throw new Error(result.stderr || `git ${args[0]} failed`);
  }
  return result.stdout.trim();
}

function resolveWithin(root: string, value: string): string {
  if (isAbsolute(value)) throw new Error(`evidence path must be relative: ${value}`);
  const target = resolve(root, value);
  const rel = relative(root, target);
  if (rel === '..' || rel.startsWith(`..${sep}`)) throw new Error(`evidence path escapes snapshot: ${value}`);
  return target;
}

function boundText(value: string, maxBytes: number): string {
  let redacted = value;
  for (const { pattern } of SECRET_CONTENT_RULES) {
    redacted = redacted.replace(
      new RegExp(pattern.source, `${pattern.flags}g`),
      '[REDACTED]',
    );
  }
  const buffer = Buffer.from(redacted);
  if (buffer.length <= maxBytes) return redacted;
  return `${buffer.subarray(0, Math.max(0, maxBytes - 32)).toString('utf8')}\n[output truncated]`;
}

function resolveExecutable(command: string): string {
  const pathValue = process.env.PATH ?? '/usr/bin:/bin';
  for (const directory of pathValue.split(':').filter(Boolean)) {
    const candidate = resolve(directory, command);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue through the bounded PATH list.
    }
  }
  throw new Error(`review evidence executable is unavailable: ${command}`);
}

type EvidenceSystemToolAccess = {
  roots: string[];
  literals: string[];
  mapExecutableLiterals: string[];
  identityDigest: string;
  verifyUnchanged: () => boolean;
};

function evidenceSystemToolAccess(tools: string[]): EvidenceSystemToolAccess {
  if (tools.length === 0) {
    return { roots: [], literals: [], mapExecutableLiterals: [], identityDigest: sha256('no-system-tools'), verifyUnchanged: () => true };
  }
  if (process.platform !== 'darwin') {
    throw new Error('declared evidence system tools require a supported host adapter');
  }
  const entries = tools.filter((tool) => tool === 'git').map((tool) => {
    const selected = spawnSync('/usr/bin/xcode-select', ['-p'], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    const developerRoot = selected.status === 0 ? selected.stdout.trim() : '';
    if (!isAbsolute(developerRoot) || !existsSync(developerRoot)) {
      throw new Error('declared git evidence tool requires an active Apple developer directory');
    }
    const located = spawnSync('/usr/bin/xcrun', ['--find', 'git'], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    const executable = located.status === 0 ? located.stdout.trim() : '';
    const realDeveloperRoot = realpathSync(developerRoot);
    const realRoot = realDeveloperRoot.endsWith(`${sep}Contents${sep}Developer`)
      ? dirname(realDeveloperRoot)
      : realDeveloperRoot;
    const realExecutable = executable && existsSync(executable) ? realpathSync(executable) : '';
    if (!realExecutable.startsWith(`${realRoot}${sep}`)) {
      throw new Error('declared git evidence tool resolved outside the active Apple developer directory');
    }
    return {
      tool,
      root: realRoot,
      launcher: '/usr/bin/git',
      executable: realExecutable,
      executableDigest: executableContentDigest(realExecutable),
    };
  });
  const literals = uniqueSorted([
    ...entries.flatMap((entry) => [entry.launcher, entry.executable]),
    ...(entries.length > 0
      ? ['/Library/Preferences/com.apple.dt.Xcode.plist'].filter(existsSync)
      : []),
  ]);
  const literalDigests = literals.map((file) => ({ file, digest: executableContentDigest(file) }));
  const identityDigest = sha256(stableJson({ entries, literalDigests }));
  return {
    roots: uniqueSorted(entries.map((entry) => entry.root).filter(Boolean)),
    literals,
    mapExecutableLiterals: uniqueSorted(entries.map((entry) => entry.executable)),
    identityDigest,
    verifyUnchanged: () => entries.every((entry) =>
      existsSync(entry.executable) && executableContentDigest(entry.executable) === entry.executableDigest) &&
      literalDigests.every((entry) =>
        existsSync(entry.file) && executableContentDigest(entry.file) === entry.digest),
  };
}

function executableContentDigest(executable: string): string {
  const stat = statSync(executable);
  const cacheKey = `${executable}:${stat.size}:${stat.mtimeMs}`;
  const cached = executableDigestCache.get(cacheKey);
  if (cached) return cached;
  const digest = sha256(readFileSync(executable));
  executableDigestCache.set(cacheKey, digest);
  return digest;
}

function dependencyProjectionDigest(root: string, changedFiles: string[]): string {
  const entries: Array<{ path: string; digest: string }> = [];
  const contractNames = new Set([
    'package.json',
    'bun.lock',
    'bun.lockb',
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
  ]);
  const projectRoots = new Set<string>(['']);
  for (const file of changedFiles) {
    const parts = file.split('/').filter(Boolean);
    for (let index = 1; index < parts.length; index += 1) {
      projectRoots.add(parts.slice(0, index).join('/'));
    }
  }
  for (const projectRoot of projectRoots) {
    for (const name of contractNames) {
      const relativePath = projectRoot ? `${projectRoot}/${name}` : name;
      const file = resolveWithin(root, relativePath);
      if (existsSync(file) && statSync(file).isFile()) {
        entries.push({ path: relativePath, digest: sha256(readFileSync(file)) });
      }
    }
  }
  for (const relativePath of dependencyRelativePaths(changedFiles)) {
    collectDependencyMetadata(root, relativePath, entries);
  }
  return sha256(stableJson(entries.sort((left, right) => left.path.localeCompare(right.path))));
}

function snapshotContentDigest(root: string, ignoredRoots: string[]): string {
  const ignored = ignoredRoots.map((value) => value.replaceAll('\\', '/').replace(/\/$/, ''));
  const entries: Array<{ path: string; kind: string; mode?: number; digest?: string }> = [];
  const pending: Array<{ absolute: string; relative: string }> = [{ absolute: root, relative: '' }];
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const entry of readdirSync(current.absolute, { withFileTypes: true })) {
      const relativePath = current.relative ? `${current.relative}/${entry.name}` : entry.name;
      if (ignored.some((prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`))) continue;
      visited += 1;
      if (visited > 100_000) throw new Error('review candidate snapshot exceeds 100000 entries');
      const absolute = join(current.absolute, entry.name);
      if (entry.isDirectory()) {
        entries.push({ path: relativePath, kind: 'directory' });
        pending.push({ absolute, relative: relativePath });
      } else if (entry.isSymbolicLink()) {
        entries.push({ path: relativePath, kind: 'symlink', digest: sha256(readlinkSync(absolute)) });
      } else if (entry.isFile()) {
        entries.push({
          path: relativePath,
          kind: 'file',
          mode: statSync(absolute).mode & 0o777,
          digest: sha256(readFileSync(absolute)),
        });
      } else {
        throw new Error(`review candidate snapshot contains unsupported entry: ${relativePath}`);
      }
    }
  }
  return sha256(stableJson(entries.sort((left, right) => left.path.localeCompare(right.path))));
}

function collectDependencyMetadata(
  root: string,
  relativeRoot: string,
  entries: Array<{ path: string; digest: string }>,
): void {
  const start = resolveWithin(root, relativeRoot);
  if (!existsSync(start)) return;
  const pending: Array<{ absolute: string; relative: string }> = [{
    absolute: start,
    relative: relativeRoot,
  }];
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    visited += 1;
    if (visited > 100_000) {
      throw new Error('review dependency projection exceeds 100000 entries');
    }
    for (const entry of readdirSync(current.absolute, { withFileTypes: true })) {
      const absolute = join(current.absolute, entry.name);
      const relativePath = `${current.relative}/${entry.name}`;
      if (entry.isDirectory()) {
        pending.push({ absolute, relative: relativePath });
        continue;
      }
      if (entry.isSymbolicLink()) {
        entries.push({ path: relativePath, digest: sha256(`symlink:${readlinkSync(absolute)}`) });
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`review dependency projection contains unsupported entry: ${relativePath}`);
      }
      entries.push({ path: relativePath, digest: sha256(readFileSync(absolute)) });
    }
  }
}

function mockEvidenceManifest(): ReviewEvidenceManifest {
  return {
    schemaVersion: 1,
    behaviorMatrix: [{
      id: 'mock-review-contract',
      behavior: 'The mock candidate is exercised by the deterministic fixture gate.',
      kind: 'normal',
      input: 'fixture diff',
      preconditions: 'mock workflow mode',
      expected: 'fixture gate exits successfully',
      risk: 'low',
      disposition: 'static',
      providerIds: ['mock-static-gate'],
    }],
    providers: [{
      id: 'mock-static-gate',
      owner: 'review-runtime-test-fixture',
      kind: 'static',
      cellIds: ['mock-review-contract'],
      changedPathPrefixes: [],
      operations: [{
        id: 'mock-pass',
        target: 'candidate',
        argv: ['true'],
        expectedExit: 'zero',
        timeoutMs: 1000,
        maxOutputBytes: 1024,
        network: 'deny',
        evidenceLevel: 'fixture',
        requiredSystemTools: [],
      }],
    }],
    authorizations: [],
  };
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error('optional value must be a string');
  return value.trim() || undefined;
}

function requiredId(value: unknown, label: string): string {
  const id = requiredString(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) throw new Error(`${label} has invalid ID syntax`);
  return id;
}

function requiredStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} must be a non-empty string array`);
  return value.map((entry) => requiredString(entry, label));
}

function optionalStringArray(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be a string array`);
  return value.map((entry) => requiredString(entry, label));
}

function requiredIdArray(value: unknown, label: string): string[] {
  return requiredStringArray(value, label).map((entry) => requiredId(entry, label));
}

function optionalIdArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new Error(`${label} must be an ID array`);
  return value.map((entry) => requiredId(entry, label));
}

function boundedInteger(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}`);
  }
  return value as number;
}

function validDate(value: unknown, label: string): string {
  const text = requiredString(value, label);
  if (!Number.isFinite(Date.parse(text))) throw new Error(`${label} must be an ISO date`);
  return text;
}

function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label} IDs must be unique`);
}

function assertSha256(value: unknown, label: string): void {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a SHA-256 digest`);
  }
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function uniqueInOrder(values: string[]): string[] {
  return [...new Set(values)];
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>;
    return `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${stableJson(item[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function createReviewArtifactPath(root: string, runId: string): string {
  mkdirSync(root, { recursive: true });
  const suffix = randomBytes(4).toString('hex');
  return join(root, `${runId}-${suffix}-review-evidence.json`);
}

export function writeInitialReviewArtifact(
  file: string,
  artifact: InitialReviewArtifactPayload,
  ctx: WorkflowContext,
  reviewScope: InitialReviewRuntimeReceipt['reviewScope'] = { kind: 'standalone' },
): InitialReviewArtifact {
  const canonicalArtifact = JSON.parse(JSON.stringify(artifact)) as InitialReviewArtifactPayload;
  const receipt: InitialReviewRuntimeReceipt = {
    schemaVersion: 1,
    id: `${safePathSegment(artifact.runId)}-${randomBytes(16).toString('hex')}`,
    runId: canonicalArtifact.runId,
    artifactDigest: sha256(stableJson(canonicalArtifact)),
    repository: canonicalArtifact.binding.repository,
    candidateDigest: canonicalArtifact.binding.candidateDigest,
    behaviorContractDigest: canonicalArtifact.binding.behaviorContractDigest,
    findingsDigest: sha256(stableJson(canonicalArtifact.findings)),
    evidenceDigest: sha256(stableJson(canonicalArtifact.evidence)),
    reviewScope,
    issuedAt: canonicalArtifact.createdAt,
  };
  const receiptDigest = sha256(stableJson(receipt));
  const authority = reviewReceiptAuthority(ctx);
  const signature = signReviewReceipt(receiptDigest, authority.key);
  const receiptRoot = authority.receiptRoot;
  mkdirSync(receiptRoot, { recursive: true, mode: 0o700 });
  const receiptFile = join(receiptRoot, `${receipt.id}.json`);
  writeFileSync(
    receiptFile,
    `${JSON.stringify(receipt, null, 2)}\n`,
    { mode: 0o600, flag: 'wx' },
  );
  const issued: InitialReviewArtifact = {
    ...canonicalArtifact,
    runtimeReceipt: {
      schemaVersion: 1,
      id: receipt.id,
      digest: receiptDigest,
      signature,
      reviewScope: receipt.reviewScope,
    },
  };
  mkdirSync(dirname(file), { recursive: true });
  try {
    writeFileSync(file, `${JSON.stringify(issued, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  } catch (error) {
    rmSync(receiptFile, { force: true });
    throw error;
  }
  return issued;
}

function validateInitialReviewRuntimeReceipt(
  ctx: WorkflowContext,
  artifact: InitialReviewArtifact,
): void {
  const authority = reviewReceiptAuthority(ctx);
  const receiptRoot = authority.receiptRoot;
  const receiptFile = join(receiptRoot, `${artifact.runtimeReceipt.id}.json`);
  let receipt: InitialReviewRuntimeReceipt;
  try {
    const stat = lstatSync(receiptFile, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.isSymbolicLink()) throw new Error('not a regular file');
    receipt = JSON.parse(readFileSync(receiptFile, 'utf8')) as InitialReviewRuntimeReceipt;
  } catch {
    throw new Error('closure requires a runtime-owned initial review receipt');
  }
  if (
    receipt.schemaVersion !== 1 ||
    receipt.id !== artifact.runtimeReceipt.id ||
    sha256(stableJson(receipt)) !== artifact.runtimeReceipt.digest ||
    !verifyReviewReceiptSignature(
      artifact.runtimeReceipt.digest,
      artifact.runtimeReceipt.signature,
      authority.key,
    ) ||
    receipt.runId !== artifact.runId ||
    receipt.repository !== artifact.binding.repository ||
    receipt.candidateDigest !== artifact.binding.candidateDigest ||
    receipt.behaviorContractDigest !== artifact.binding.behaviorContractDigest ||
    receipt.findingsDigest !== sha256(stableJson(artifact.findings)) ||
    receipt.evidenceDigest !== sha256(stableJson(artifact.evidence)) ||
    stableJson(receipt.reviewScope) !== stableJson(artifact.runtimeReceipt.reviewScope) ||
    (ctx.options.workId
      ? receipt.reviewScope.kind !== 'work-map' ||
        receipt.reviewScope.workId !== ctx.options.workId ||
        receipt.reviewScope.ticketId !== ctx.options.ticketId
      : receipt.reviewScope.kind !== 'standalone') ||
    receipt.issuedAt !== artifact.createdAt
  ) {
    throw new Error('closure initial review receipt is stale, forged, or mismatched');
  }
  const { runtimeReceipt: _runtimeReceipt, ...payload } = artifact;
  if (receipt.artifactDigest !== sha256(stableJson(payload))) {
    throw new Error('closure initial review artifact does not match its runtime receipt');
  }
}

function validateInitialReviewScope(value: unknown): InitialReviewScope {
  const scope = asObject(value, 'initial review runtime receipt scope');
  if (scope.kind === 'standalone') return { kind: 'standalone' };
  if (scope.kind !== 'work-map') {
    throw new Error('initial review runtime receipt scope kind is invalid');
  }
  const mapRevision = boundedInteger(scope.mapRevision, 'initial review scope.mapRevision', 0, Number.MAX_SAFE_INTEGER);
  const claimAttempt = boundedInteger(scope.claimAttempt, 'initial review scope.claimAttempt', 1, Number.MAX_SAFE_INTEGER);
  assertSha256(scope.subjectDigest, 'initial review scope.subjectDigest');
  return {
    kind: 'work-map',
    workId: requiredId(scope.workId, 'initial review scope.workId'),
    ticketId: requiredId(scope.ticketId, 'initial review scope.ticketId'),
    mapRevision,
    claimAttempt,
    subjectDigest: String(scope.subjectDigest),
  };
}

function reviewReceiptAuthority(ctx: WorkflowContext): { key: Buffer; receiptRoot: string } {
  if (ctx.options.mode === 'mock') {
    return {
      key: mockReviewReceiptAuthorityKey,
      receiptRoot: join(stateRoot(ctx.options), 'workflow-runs', 'mock-review-receipts'),
    };
  }
  const configuredRuntimeFile =
    ctx.options.reviewReceiptTrustedConfig ??
    process.env[REVIEW_RECEIPT_TRUSTED_CONFIG_ENV];
  const launcherArgument = process.argv[1];
  if (!configuredRuntimeFile && !launcherArgument) {
    throw new Error('review receipt authority requires the installed launcher');
  }
  const launcher = launcherArgument ? realpathSync(launcherArgument) : undefined;
  if (!configuredRuntimeFile && (!launcher || !['run.ts', 'run.js'].includes(basename(launcher)))) {
    throw new Error('review receipt authority requires the trusted installed Goldband launcher');
  }
  const runtimeRoot = configuredRuntimeFile
    ? dirname(resolve(configuredRuntimeFile))
    : dirname(dirname(launcher!));
  const trustedRuntimeFile = configuredRuntimeFile
    ? resolve(configuredRuntimeFile)
    : join(runtimeRoot, 'trusted-runtime.json');
  if (trustedRuntimeFile !== join(runtimeRoot, 'trusted-runtime.json')) {
    throw new Error('review receipt trusted runtime config has a non-canonical path');
  }
  const trustedRuntimeStat = lstatSync(trustedRuntimeFile, { throwIfNoEntry: false });
  if (!trustedRuntimeStat?.isFile() || trustedRuntimeStat.isSymbolicLink() ||
      (trustedRuntimeStat.mode & 0o077) !== 0 ||
      (typeof process.getuid === 'function' && trustedRuntimeStat.uid !== process.getuid())) {
    throw new Error('review receipt trusted runtime config is missing or unsafe');
  }
  const trustedRuntime = JSON.parse(readFileSync(trustedRuntimeFile, 'utf8')) as {
    schemaVersion?: unknown;
    reviewReceiptAuthorityRoot?: unknown;
    reviewReceiptKeyFile?: unknown;
    reviewReceiptStore?: unknown;
  };
  if (trustedRuntime.schemaVersion !== 2 ||
      typeof trustedRuntime.reviewReceiptAuthorityRoot !== 'string' ||
      typeof trustedRuntime.reviewReceiptKeyFile !== 'string' ||
      typeof trustedRuntime.reviewReceiptStore !== 'string') {
    throw new Error('trusted runtime is missing review receipt authority paths');
  }
  const authorityRoot = resolve(trustedRuntime.reviewReceiptAuthorityRoot);
  const keyFile = resolve(trustedRuntime.reviewReceiptKeyFile);
  const receiptRoot = resolve(trustedRuntime.reviewReceiptStore);
  if (keyFile !== join(authorityRoot, 'review-receipt.key') ||
      receiptRoot !== join(authorityRoot, 'review-receipts')) {
    throw new Error('trusted runtime review receipt authority escapes its owned root');
  }
  const stat = lstatSync(keyFile, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error('review receipt authority key is missing or has unsafe permissions');
  }
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new Error('review receipt authority key has the wrong owner');
  }
  const encoded = readFileSync(keyFile, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/.test(encoded)) {
    throw new Error('review receipt authority key is invalid');
  }
  if (existsSync(receiptRoot)) {
    const receiptRootStat = lstatSync(receiptRoot);
    if (!receiptRootStat.isDirectory() || receiptRootStat.isSymbolicLink() ||
        (receiptRootStat.mode & 0o077) !== 0) {
      throw new Error('review receipt authority store has unsafe permissions');
    }
  }
  return { key: Buffer.from(encoded, 'hex'), receiptRoot };
}

export function removeInitialReviewRuntimeReceipt(ctx: WorkflowContext, id: string): void {
  const safeId = requiredId(id, 'initial review runtime receipt id');
  const { receiptRoot } = reviewReceiptAuthority(ctx);
  rmSync(join(receiptRoot, `${safeId}.json`), { force: true });
}

export function claimInitialReviewClosure(
  ctx: WorkflowContext,
  artifact: InitialReviewArtifact,
  repairedCandidateDigest: string,
): string {
  validateInitialReviewRuntimeReceipt(ctx, artifact);
  assertSha256(repairedCandidateDigest, 'repaired closure candidate digest');
  const { receiptRoot } = reviewReceiptAuthority(ctx);
  const claimRoot = join(receiptRoot, 'closure-claims');
  mkdirSync(claimRoot, { recursive: true, mode: 0o700 });
  const claimFile = join(
    claimRoot,
    `${requiredId(artifact.runtimeReceipt.id, 'initial review runtime receipt id')}.json`,
  );
  try {
    writeFileSync(claimFile, `${JSON.stringify({
      schemaVersion: 1,
      initialReceiptId: artifact.runtimeReceipt.id,
      initialReceiptDigest: artifact.runtimeReceipt.digest,
      closureRunId: ctx.runId,
      repairedCandidateDigest,
      reviewScope: artifact.runtimeReceipt.reviewScope,
      semantics: 'at-most-once',
      claimedAt: new Date().toISOString(),
    }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
      throw new Error('closure initial review receipt has already been claimed');
    }
    throw error;
  }
  return claimFile;
}

function signReviewReceipt(receiptDigest: string, key: Buffer): string {
  return createHmac('sha256', key)
    .update(`goldband-review-receipt-v1\0${receiptDigest}`)
    .digest('hex');
}

function verifyReviewReceiptSignature(
  receiptDigest: string,
  signature: string,
  key: Buffer,
): boolean {
  if (!/^[a-f0-9]{64}$/.test(signature)) return false;
  const expected = Buffer.from(signReviewReceipt(receiptDigest, key), 'hex');
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}
