import { createHash, randomUUID } from "node:crypto";
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	realpathSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, parse, resolve } from "node:path";

type ReviewExecutionLeaseRecord = {
	pid: number;
	token: string;
	repository: string;
	scope: string;
	startedAt: string;
};

export type ReviewExecutionLease = {
	file: string;
	token: string;
};

type ReviewExecutionLeaseOptions = {
	pid?: number;
	isProcessAlive?: (pid: number) => boolean;
	afterStaleLeaseRead?: () => void;
};

export function acquireReviewExecutionLease(
	stateRoot: string,
	cwd: string,
	runtimeArgs: string[],
	options: ReviewExecutionLeaseOptions = {},
): ReviewExecutionLease {
	const repository = canonicalRepositoryRoot(cwd);
	const invocationDirectory = realpathSync(cwd);
	const scope = normalizedReviewScope(invocationDirectory, runtimeArgs);
	const file = reviewExecutionLeasePath(stateRoot, repository, scope);
	const record: ReviewExecutionLeaseRecord = {
		pid: options.pid ?? process.pid,
		token: randomUUID(),
		repository,
		scope,
		startedAt: new Date().toISOString(),
	};
	const isProcessAlive = options.isProcessAlive ?? processIsAlive;
	mkdirSync(dirname(file), { recursive: true });

	try {
		writeNewLease(file, record);
		return { file, token: record.token };
	} catch (error) {
		if (!isAlreadyExists(error)) throw error;
	}

	const existing = readLeaseRecord(file);
	if (isProcessAlive(existing.pid)) throw activeLeaseError(existing);
	options.afterStaleLeaseRead?.();
	return replaceStaleLease(file, record, isProcessAlive);
}

export function releaseReviewExecutionLease(lease: ReviewExecutionLease): void {
	let existing: ReviewExecutionLeaseRecord;
	try {
		existing = readLeaseRecord(lease.file);
	} catch (error) {
		if (isMissing(error)) return;
		throw error;
	}
	if (existing.token !== lease.token) return;
	unlinkSync(lease.file);
}

function reviewExecutionLeasePath(
	stateRoot: string,
	repository: string,
	scope: string,
): string {
	const digest = createHash("sha256")
		.update(JSON.stringify({ repository, scope }))
		.digest("hex");
	return join(stateRoot, "workflow-runs", "active-review", `${digest}.json`);
}

function replaceStaleLease(
	file: string,
	replacement: ReviewExecutionLeaseRecord,
	isProcessAlive: (pid: number) => boolean,
): ReviewExecutionLease {
	const recoveryFile = `${file}.recovery`;
	const recoveryToken = randomUUID();
	try {
		writeExclusiveJson(recoveryFile, {
			pid: replacement.pid,
			token: recoveryToken,
			startedAt: new Date().toISOString(),
		});
	} catch (error) {
		if (!isAlreadyExists(error)) throw error;
		throw new Error(
			"review/code stale lease recovery is already in progress; wait for that launcher instead of starting another paid review",
		);
	}

	const replacementFile = `${file}.${replacement.token}.replacement`;
	try {
		const current = readLeaseRecord(file);
		if (isProcessAlive(current.pid)) throw activeLeaseError(current);
		writeNewLease(replacementFile, replacement);
		renameSync(replacementFile, file);
		return { file, token: replacement.token };
	} finally {
		unlinkIfOwned(replacementFile, replacement.token);
		unlinkIfOwned(recoveryFile, recoveryToken);
	}
}

function writeNewLease(file: string, record: ReviewExecutionLeaseRecord): void {
	writeExclusiveJson(file, record);
}

function writeExclusiveJson(file: string, value: unknown): void {
	const fd = openSync(file, "wx", 0o600);
	try {
		writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
	} finally {
		closeSync(fd);
	}
}

function unlinkIfOwned(file: string, token: string): void {
	let value: unknown;
	try {
		value = JSON.parse(readFileSync(file, "utf8"));
	} catch (error) {
		if (isMissing(error)) return;
		throw error;
	}
	if (
		value &&
		typeof value === "object" &&
		"token" in value &&
		value.token === token
	) {
		unlinkSync(file);
	}
}

function activeLeaseError(existing: ReviewExecutionLeaseRecord): Error {
	return new Error(
		`review/code is already running for this repository and scope (pid ${existing.pid}, started ${existing.startedAt}); wait for that report instead of launching a duplicate`,
	);
}

function normalizedReviewScope(
	invocationDirectory: string,
	runtimeArgs: string[],
): string {
	let staged = false;
	let worktree = false;
	let base: string | undefined;
	let diffFile: string | undefined;
	let includeUntracked = false;
	for (let index = 0; index < runtimeArgs.length; index += 1) {
		const arg = runtimeArgs[index];
		if (arg === "--staged") {
			staged = true;
			continue;
		}
		if (arg === "--worktree") {
			worktree = true;
			continue;
		}
		if (arg === "--include-untracked") {
			includeUntracked = true;
			continue;
		}
		if (arg === "--base") {
			base = runtimeArgs[index + 1] ?? "";
			index += 1;
			continue;
		}
		if (arg === "--diff-file") {
			const value = runtimeArgs[index + 1] ?? "";
			diffFile = resolve(invocationDirectory, value);
			index += 1;
		}
	}
	return JSON.stringify({
		staged,
		worktree,
		base,
		diffFile,
		includeUntracked,
	});
}

function readLeaseRecord(file: string): ReviewExecutionLeaseRecord {
	let value: unknown;
	try {
		value = JSON.parse(readFileSync(file, "utf8"));
	} catch (error) {
		if (isMissing(error)) throw error;
		throw new Error(
			`review/code execution lease is unreadable; inspect or remove the stale lease manually: ${file}`,
		);
	}
	if (
		!value ||
		typeof value !== "object" ||
		!("pid" in value) ||
		!Number.isSafeInteger(value.pid) ||
		!("token" in value) ||
		typeof value.token !== "string" ||
		!("repository" in value) ||
		typeof value.repository !== "string" ||
		!("scope" in value) ||
		typeof value.scope !== "string" ||
		!("startedAt" in value) ||
		typeof value.startedAt !== "string"
	) {
		throw new Error(
			`review/code execution lease is invalid; inspect or remove the stale lease manually: ${file}`,
		);
	}
	return value as ReviewExecutionLeaseRecord;
}

function processIsAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return !isNoSuchProcess(error);
	}
}

function isAlreadyExists(error: unknown): boolean {
	return errorCode(error) === "EEXIST";
}

function isMissing(error: unknown): boolean {
	return errorCode(error) === "ENOENT";
}

function isNoSuchProcess(error: unknown): boolean {
	return errorCode(error) === "ESRCH";
}

function errorCode(error: unknown): string | undefined {
	if (!error || typeof error !== "object" || !("code" in error))
		return undefined;
	return String(error.code);
}

function canonicalRepositoryRoot(cwd: string): string {
	let current = realpathSync(cwd);
	const filesystemRoot = parse(current).root;
	while (true) {
		if (existsSync(join(current, ".git"))) return current;
		if (current === filesystemRoot) return realpathSync(cwd);
		current = dirname(current);
	}
}
