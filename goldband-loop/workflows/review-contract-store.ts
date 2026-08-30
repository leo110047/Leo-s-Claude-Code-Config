import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  reviewEvidenceManifestSchema,
  type ReviewEvidenceManifest,
} from './review-evidence';

const STORE_SCHEMA_VERSION = 1;
const MAX_MANIFEST_BYTES = 1024 * 1024;

export type ReviewContractRepositoryIdentity = {
  kind: 'git-common-directory';
  commonDirectory: string;
  commonDirectoryInstanceDigest: string;
  remoteIdentityDigest: string;
};

type ReviewContractStoreEntry = {
  schemaVersion: 1;
  repository: ReviewContractRepositoryIdentity;
  manifest: ReviewEvidenceManifest;
  manifestDigest: string;
  importedFrom: string;
  importedAt: string;
};

export type ReviewContractStoreInspection = {
  repository: ReviewContractRepositoryIdentity;
  entryFile: string;
  entry?: ReviewContractStoreEntry;
  invalidReason?: string;
};

export function inspectReviewContractStore(
  cwd: string,
  stateRoot: string,
): ReviewContractStoreInspection {
  const repository = resolveReviewContractRepositoryIdentity(cwd);
  const entryFile = reviewContractEntryFile(stateRoot, repository);
  const directory = reviewContractStoreDirectory(stateRoot);
  if (existsSync(directory)) assertPrivateStoreDirectory(directory);
  if (!existsSync(entryFile)) return { repository, entryFile };
  try {
    return {
      repository,
      entryFile,
      entry: readAndValidateStoreEntry(entryFile, repository),
    };
  } catch (error) {
    return {
      repository,
      entryFile,
      invalidReason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function importReviewContract(
  cwd: string,
  stateRoot: string,
  manifestFile: string,
): ReviewContractStoreInspection {
  const repository = resolveReviewContractRepositoryIdentity(cwd);
  const source = resolve(cwd, manifestFile);
  const manifest = reviewEvidenceManifestSchema.validate(
    JSON.parse(readStableRegularFile(source).toString('utf8')),
  );
  const directory = reviewContractStoreDirectory(stateRoot);
  ensurePrivateDirectory(directory);
  const entryFile = reviewContractEntryFile(stateRoot, repository);
  const entry: ReviewContractStoreEntry = {
    schemaVersion: STORE_SCHEMA_VERSION,
    repository,
    manifest,
    manifestDigest: digestManifest(manifest),
    importedFrom: realpathSync(source),
    importedAt: new Date().toISOString(),
  };
  if (existsSync(entryFile)) {
    assertPrivateRegularFile(entryFile, 'review contract store entry');
  }
  writeAtomicPrivateJson(entryFile, entry);
  return { repository, entryFile, entry: readAndValidateStoreEntry(entryFile, repository) };
}

export function removeReviewContract(
  cwd: string,
  stateRoot: string,
): ReviewContractStoreInspection {
  const before = inspectReviewContractStore(cwd, stateRoot);
  if (before.entry || before.invalidReason) {
    assertPrivateRegularFile(before.entryFile, 'review contract store entry');
    rmSync(before.entryFile);
  }
  return inspectReviewContractStore(cwd, stateRoot);
}

export function resolveReviewContractRepositoryIdentity(
  cwd: string,
): ReviewContractRepositoryIdentity {
  let root = '';
  let common = '';
  try {
    root = git(cwd, ['rev-parse', '--show-toplevel']);
    common = git(cwd, ['rev-parse', '--git-common-dir']);
  } catch {
    throw new Error('review contract store requires an unambiguous Git repository');
  }
  if (!root || !common) {
    throw new Error('review contract store requires an unambiguous Git repository');
  }
  const commonDirectory = realpathSync(resolve(cwd, common));
  const commonDirectoryMetadata = lstatSync(commonDirectory, { bigint: true });
  if (!commonDirectoryMetadata.isDirectory()) {
    throw new Error('review contract store requires a regular Git common directory');
  }
  const remotes = git(cwd, ['remote'])
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean)
    .sort();
  const remoteIdentity = remotes.map((remote) => ({
    remote,
    urls: git(cwd, ['remote', 'get-url', '--all', remote])
      .split('\n')
      .map((value) => value.trim())
      .filter(Boolean)
      .sort(),
  }));
  return {
    kind: 'git-common-directory',
    commonDirectory,
    commonDirectoryInstanceDigest: sha256(stableJson({
      device: commonDirectoryMetadata.dev.toString(),
      inode: commonDirectoryMetadata.ino.toString(),
      birthtimeNs: commonDirectoryMetadata.birthtimeNs.toString(),
    })),
    remoteIdentityDigest: sha256(stableJson(remoteIdentity)),
  };
}

export function digestManifest(manifest: ReviewEvidenceManifest): string {
  return sha256(stableJson(manifest));
}

function reviewContractStoreDirectory(stateRoot: string): string {
  return join(stateRoot, 'review-contracts');
}

function reviewContractEntryFile(
  stateRoot: string,
  repository: ReviewContractRepositoryIdentity,
): string {
  return join(
    reviewContractStoreDirectory(stateRoot),
    `${sha256(repository.commonDirectory)}.json`,
  );
}

function readAndValidateStoreEntry(
  file: string,
  repository: ReviewContractRepositoryIdentity,
): ReviewContractStoreEntry {
  assertPrivateRegularFile(file, 'review contract store entry');
  const value = JSON.parse(readFileSync(file, 'utf8')) as Partial<ReviewContractStoreEntry>;
  if (value.schemaVersion !== STORE_SCHEMA_VERSION || !value.repository || !value.manifest) {
    throw new Error('review contract store entry is invalid');
  }
  if (
    value.repository.kind !== repository.kind ||
    value.repository.commonDirectory !== repository.commonDirectory ||
    value.repository.commonDirectoryInstanceDigest !== repository.commonDirectoryInstanceDigest
  ) {
    throw new Error('review contract store repository identity mismatch; re-import explicitly');
  }
  if (value.repository.remoteIdentityDigest !== repository.remoteIdentityDigest) {
    throw new Error('review contract store remote identity changed; re-import explicitly');
  }
  const manifest = reviewEvidenceManifestSchema.validate(value.manifest);
  const manifestDigest = digestManifest(manifest);
  if (value.manifestDigest !== manifestDigest) {
    throw new Error('review contract store manifest digest mismatch');
  }
  if (typeof value.importedFrom !== 'string' || !value.importedFrom ||
      typeof value.importedAt !== 'string' || !Number.isFinite(Date.parse(value.importedAt))) {
    throw new Error('review contract store provenance is invalid');
  }
  return {
    schemaVersion: 1,
    repository: value.repository,
    manifest,
    manifestDigest,
    importedFrom: value.importedFrom,
    importedAt: value.importedAt,
  };
}

function readStableRegularFile(file: string): Buffer {
  const pathBefore = lstatSync(file);
  if (pathBefore.isSymbolicLink() || !pathBefore.isFile()) {
    throw new Error('review contract import manifest must be a regular file, not a symlink');
  }
  if (pathBefore.size > MAX_MANIFEST_BYTES) {
    throw new Error(`review contract import manifest exceeds ${MAX_MANIFEST_BYTES} bytes`);
  }
  const descriptor = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.ino !== BigInt(pathBefore.ino) || before.dev !== BigInt(pathBefore.dev)) {
      throw new Error('review contract import manifest changed while being opened');
    }
    const content = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < content.length) {
      const count = readSync(descriptor, content, offset, content.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    const after = fstatSync(descriptor, { bigint: true });
    const pathAfter = lstatSync(file);
    if (
      offset !== content.length || before.size !== after.size || before.ino !== after.ino ||
      before.dev !== after.dev || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs ||
      pathAfter.isSymbolicLink() || !pathAfter.isFile() || BigInt(pathAfter.ino) !== before.ino ||
      BigInt(pathAfter.dev) !== before.dev
    ) {
      throw new Error('review contract import manifest changed while being read');
    }
    return content;
  } finally {
    closeSync(descriptor);
  }
}

function ensurePrivateDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const metadata = lstatSync(directory);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error('review contract store is not a private regular directory');
  }
  if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) {
    throw new Error('review contract store is not owned by the current user');
  }
  if ((metadata.mode & 0o077) !== 0) chmodSync(directory, 0o700);
}

function assertPrivateStoreDirectory(directory: string): void {
  const metadata = lstatSync(directory);
  if (metadata.isSymbolicLink() || !metadata.isDirectory() || (metadata.mode & 0o077) !== 0) {
    throw new Error('review contract store directory is unsafe');
  }
  if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) {
    throw new Error('review contract store directory is not owned by the current user');
  }
}

function assertPrivateRegularFile(file: string, label: string): void {
  const metadata = lstatSync(file);
  if (metadata.isSymbolicLink() || !metadata.isFile() || (metadata.mode & 0o077) !== 0) {
    throw new Error(`${label} is unsafe`);
  }
  if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) {
    throw new Error(`${label} is not owned by the current user`);
  }
}

function writeAtomicPrivateJson(file: string, value: unknown): void {
  ensurePrivateDirectory(dirname(file));
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', ['--no-pager', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1' },
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `git ${args[0]} failed`);
  }
  return result.stdout.trim();
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>;
    return `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${stableJson(item[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
