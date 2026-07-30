import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { resolveGoldbandStateRoot } from "../lib/state-root";
import {
	assertWorkMapTransition,
	calculateBlockers,
	calculateFrontier,
	parseWorkMap,
	parseWorkMapCreateInput,
	stableJson,
	type WorkMapCreateInput,
	type WorkMapV1,
	workMapDigest,
} from "./work-map";

type RepositoryContext = WorkMapV1["repository"] & {
	repositoryId: string;
};

type ActivePointer = {
	schemaVersion: 1;
	entries: Record<
		string,
		{
			workId: string;
			repositoryIdentity: string;
			cwd: string;
			branch: string;
			updatedAt: string;
		}
	>;
};

export type WorkMapTransactionStep =
	| "before-event"
	| "after-event"
	| "after-markdown"
	| "after-map";

type WorkMapTransaction = {
	schemaVersion: 1;
	kind: "create" | "update";
	beforeDigest: string | null;
	map: WorkMapV1;
	event: WorkMapEvent;
	activate: boolean;
};

const ACTIVE_POINTER_LOCK_TIMEOUT_MS = 5_000;
const ACTIVE_POINTER_LOCK_RETRY_MS = 10;

export type WorkMapEvent = {
	schemaVersion: 1;
	workId: string;
	actor: string;
	operation: string;
	beforeRevision: number | null;
	afterRevision: number;
	digest: string;
	timestamp: string;
};

export type WorkMapStoreOptions = {
	cwd: string;
	goldbandHome?: string;
	clock?: () => Date;
	idFactory?: () => string;
	transactionObserver?: (step: WorkMapTransactionStep) => void;
};

export class WorkMapStore {
	readonly repository: RepositoryContext;
	readonly workRoot: string;
	readonly activePath: string;
	readonly #clock: () => Date;
	readonly #idFactory: () => string;
	readonly #transactionObserver?: (step: WorkMapTransactionStep) => void;

	constructor(options: WorkMapStoreOptions) {
		this.repository = resolveRepositoryContext(options.cwd);
		this.#clock = options.clock ?? (() => new Date());
		this.#idFactory = options.idFactory ?? randomUUID;
		this.#transactionObserver = options.transactionObserver;
		const stateRoot = secureStateRoot(
			resolveGoldbandStateRoot(options.goldbandHome),
		);
		const projectsRoot = secureDirectory(join(stateRoot, "projects"));
		const projectRoot = secureDirectory(
			join(projectsRoot, this.repository.repositoryId),
		);
		this.workRoot = secureDirectory(join(projectRoot, "work"));
		this.activePath = join(this.workRoot, "active.json");
		assertContained(this.workRoot, this.activePath);
		assertNotSymlink(this.activePath, true);
		this.#recoverPendingTransactions();
	}

	create(rawInput: WorkMapCreateInput | unknown, actor: string): WorkMapV1 {
		const input = parseWorkMapCreateInput(rawInput);
		const workId = validWorkId(this.#idFactory());
		const workDirectory = join(this.workRoot, workId);
		assertContained(this.workRoot, workDirectory);
		if (existsSync(workDirectory)) {
			throw new Error(`Work Map already exists: ${workId}`);
		}
		mkdirSync(workDirectory, { mode: 0o700 });
		assertRealDirectory(workDirectory);
		const timestamp = this.#clock().toISOString();
		const map = parseWorkMap({
			schemaVersion: 1,
			id: workId,
			revision: 1,
			createdAt: timestamp,
			updatedAt: timestamp,
			repository: {
				identity: this.repository.identity,
				cwd: this.repository.cwd,
				branch: this.repository.branch,
				baseCommit: this.repository.baseCommit,
			},
			status: "mapped",
			...input,
			frontier: calculateFrontier(input.tickets),
			blockers: calculateBlockers(input.tickets),
		});
		try {
			const event = this.#createEvent(map, {
				actor,
				operation: "create",
				beforeRevision: null,
			});
			this.#commitTransaction({
				schemaVersion: 1,
				kind: "create",
				beforeDigest: null,
				map,
				event,
				activate: true,
			});
			return map;
		} catch (error) {
			if (!existsSync(this.#transactionPath(workId))) {
				rmSync(workDirectory, { recursive: true, force: true });
			}
			throw error;
		}
	}

	read(workId: string): WorkMapV1 {
		const release = this.#acquireLock(workId);
		try {
			this.#recoverPendingTransaction(workId);
			return this.#readMap(workId);
		} finally {
			release();
		}
	}

	update(
		workId: string,
		expectedRevision: number,
		operation: string,
		actor: string,
		mutate: (map: WorkMapV1) => WorkMapV1,
	): WorkMapV1 {
		if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
			throw new Error("expectedRevision must be a positive integer");
		}
		const validOperation = nonEmpty(operation, "operation");
		const validActor = nonEmpty(actor, "actor");
		const release = this.#acquireLock(workId);
		try {
			this.#recoverPendingTransaction(workId);
			const before = this.#readMap(workId);
			if (before.revision !== expectedRevision) {
				throw new Error(
					`stale Work Map revision: expected ${expectedRevision}, current ${before.revision}`,
				);
			}
			const candidate = mutate(structuredClone(before));
			const timestamp = this.#clock().toISOString();
			const after = parseWorkMap({
				...candidate,
				id: before.id,
				schemaVersion: before.schemaVersion,
				revision: before.revision + 1,
				createdAt: before.createdAt,
				updatedAt: timestamp,
				repository: before.repository,
				frontier: calculateFrontier(candidate.tickets),
				blockers: calculateBlockers(candidate.tickets),
			});
			assertWorkMapTransition(before, after);
			const event = this.#createEvent(after, {
				actor: validActor,
				operation: validOperation,
				beforeRevision: before.revision,
			});
			this.#commitTransaction({
				schemaVersion: 1,
				kind: "update",
				beforeDigest: workMapDigest(before),
				map: after,
				event,
				activate: false,
			});
			return after;
		} finally {
			release();
		}
	}

	setActive(workId: string): void {
		const map = this.read(workId);
		this.#writeActivePointer(map);
	}

	#writeActivePointer(map: WorkMapV1): void {
		const release = this.#acquireActivePointerLock();
		try {
			const pointer = this.#readPointer();
			pointer.entries[this.#activeKey()] = {
				workId: map.id,
				repositoryIdentity: map.repository.identity,
				cwd: map.repository.cwd,
				branch: map.repository.branch,
				updatedAt: this.#clock().toISOString(),
			};
			atomicWrite(this.activePath, stableJson(pointer));
		} finally {
			release();
		}
	}

	readActive(): WorkMapV1 | null {
		const pointer = this.#readPointer();
		const entry = pointer.entries[this.#activeKey()];
		if (!entry) return null;
		if (
			entry.repositoryIdentity !== this.repository.identity ||
			entry.cwd !== this.repository.cwd ||
			entry.branch !== this.repository.branch
		) {
			throw new Error("active Work Map repository identity mismatch");
		}
		return this.read(entry.workId);
	}

	events(workId: string): WorkMapEvent[] {
		const release = this.#acquireLock(workId);
		try {
			this.#recoverPendingTransaction(workId);
			return this.#readEvents(workId);
		} finally {
			release();
		}
	}

	mapPath(workId: string): string {
		return this.#mapPath(workId);
	}

	markdownPath(workId: string): string {
		return this.#workFile(workId, "map.md");
	}

	eventsPath(workId: string): string {
		return this.#eventsPath(workId);
	}

	#readPointer(): ActivePointer {
		if (!existsSync(this.activePath)) {
			return { schemaVersion: 1, entries: {} };
		}
		assertNotSymlink(this.activePath);
		const value = JSON.parse(readFileSync(this.activePath, "utf8")) as unknown;
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			throw new Error("active Work Map pointer must be an object");
		}
		const pointer = value as Partial<ActivePointer>;
		if (
			pointer.schemaVersion !== 1 ||
			!pointer.entries ||
			typeof pointer.entries !== "object" ||
			Array.isArray(pointer.entries)
		) {
			throw new Error("active Work Map pointer is invalid");
		}
		return pointer as ActivePointer;
	}

	#readMap(workId: string): WorkMapV1 {
		const map = this.#readMapUnchecked(workId);
		const latestEvent = this.#readEvents(workId).at(-1);
		if (
			!latestEvent ||
			latestEvent.workId !== map.id ||
			latestEvent.afterRevision !== map.revision ||
			latestEvent.digest !== workMapDigest(map)
		) {
			throw new Error(`Work Map history integrity mismatch: ${workId}`);
		}
		return map;
	}

	#readMapUnchecked(workId: string): WorkMapV1 {
		const mapPath = this.#mapPath(workId);
		assertNotSymlink(mapPath);
		const map = parseWorkMap(JSON.parse(readFileSync(mapPath, "utf8")));
		if (map.id !== workId) {
			throw new Error(
				`Work Map path identity mismatch: expected ${workId}, found ${map.id}`,
			);
		}
		this.#assertRepository(map);
		return map;
	}

	#createEvent(
		map: WorkMapV1,
		input: Pick<WorkMapEvent, "actor" | "operation" | "beforeRevision">,
	): WorkMapEvent {
		return {
			schemaVersion: 1,
			workId: map.id,
			actor: nonEmpty(input.actor, "actor"),
			operation: nonEmpty(input.operation, "operation"),
			beforeRevision: input.beforeRevision,
			afterRevision: map.revision,
			digest: workMapDigest(map),
			timestamp: this.#clock().toISOString(),
		};
	}

	#commitTransaction(transaction: WorkMapTransaction): void {
		atomicWrite(
			this.#transactionPath(transaction.map.id),
			stableJson(transaction),
		);
		this.#recoverPendingTransaction(transaction.map.id);
	}

	#recoverPendingTransactions(): void {
		for (const entry of readdirSync(this.workRoot, { withFileTypes: true })) {
			if (!entry.isDirectory() || !isValidWorkId(entry.name)) continue;
			const transactionPath = this.#transactionPath(entry.name);
			if (!existsSync(transactionPath)) continue;
			const transaction = parseTransaction(
				JSON.parse(readFileSync(transactionPath, "utf8")),
			);
			if (
				transaction.map.repository.identity !== this.repository.identity ||
				transaction.map.repository.cwd !== this.repository.cwd ||
				transaction.map.repository.branch !== this.repository.branch
			) {
				continue;
			}
			const release = this.#acquireLock(entry.name);
			try {
				this.#recoverPendingTransaction(entry.name);
			} finally {
				release();
			}
		}
	}

	#recoverPendingTransaction(workId: string): void {
		const path = this.#transactionPath(workId);
		if (!existsSync(path)) return;
		assertNotSymlink(path);
		const transaction = parseTransaction(
			JSON.parse(readFileSync(path, "utf8")),
		);
		if (transaction.map.id !== workId) {
			throw new Error("Work Map transaction identity mismatch");
		}
		this.#assertRepository(transaction.map);

		const mapPath = this.#mapPath(workId);
		if (existsSync(mapPath)) {
			const current = this.#readMapUnchecked(workId);
			const currentDigest = workMapDigest(current);
			if (
				currentDigest !== transaction.beforeDigest &&
				currentDigest !== transaction.event.digest
			) {
				throw new Error("Work Map transaction base state mismatch");
			}
		} else if (transaction.beforeDigest !== null) {
			throw new Error("Work Map transaction base state is missing");
		}

		this.#transactionObserver?.("before-event");
		const events = this.#readEvents(workId, true);
		const matchingEvent = events.find(
			(event) => event.afterRevision === transaction.event.afterRevision,
		);
		if (
			matchingEvent &&
			stableJson(matchingEvent) !== stableJson(transaction.event)
		) {
			throw new Error("Work Map transaction event conflicts with history");
		}
		if (!matchingEvent) {
			const previous = events.at(-1);
			if (
				(previous?.afterRevision ?? null) !== transaction.event.beforeRevision
			) {
				throw new Error("Work Map transaction event history mismatch");
			}
			atomicWrite(
				this.#eventsPath(workId),
				`${events.map((event) => JSON.stringify(event)).join("\n")}${events.length > 0 ? "\n" : ""}${JSON.stringify(transaction.event)}\n`,
			);
		}
		this.#transactionObserver?.("after-event");

		atomicWrite(
			this.#workFile(workId, "map.md"),
			renderWorkMapMarkdown(transaction.map),
		);
		this.#transactionObserver?.("after-markdown");
		atomicWrite(this.#mapPath(workId), stableJson(transaction.map));
		this.#transactionObserver?.("after-map");
		if (transaction.activate) this.#writeActivePointer(transaction.map);
		rmSync(path);
	}

	#readEvents(workId: string, allowMissing = false): WorkMapEvent[] {
		const path = this.#eventsPath(workId);
		if (!existsSync(path)) {
			if (allowMissing) return [];
			throw new Error(`Work Map state is missing: ${path}`);
		}
		assertNotSymlink(path);
		const content = readFileSync(path, "utf8").trim();
		if (!content) return [];
		return content.split("\n").map((line) => parseEvent(JSON.parse(line)));
	}

	#acquireLock(workId: string): () => void {
		const lock = this.#workFile(workId, ".update-lock");
		return acquireDirectoryLock(
			lock,
			`Work Map update is already in progress: ${workId}`,
			0,
		);
	}

	#acquireActivePointerLock(): () => void {
		const lock = join(this.workRoot, ".active-pointer-lock");
		assertContained(this.workRoot, lock);
		return acquireDirectoryLock(
			lock,
			"active Work Map pointer update timed out",
			ACTIVE_POINTER_LOCK_TIMEOUT_MS,
		);
	}

	#activeKey(): string {
		return createHash("sha256")
			.update(`${this.repository.cwd}\0${this.repository.branch}`)
			.digest("hex");
	}

	#assertRepository(map: WorkMapV1): void {
		if (
			map.repository.identity !== this.repository.identity ||
			map.repository.cwd !== this.repository.cwd ||
			map.repository.branch !== this.repository.branch
		) {
			throw new Error("Work Map repository identity mismatch");
		}
	}

	#mapPath(workId: string): string {
		return this.#workFile(workId, "map.json");
	}

	#eventsPath(workId: string): string {
		return this.#workFile(workId, "events.jsonl");
	}

	#transactionPath(workId: string): string {
		return this.#workFile(workId, ".pending-transaction.json");
	}

	#workFile(workId: string, file: string): string {
		const directory = join(this.workRoot, validWorkId(workId));
		assertContained(this.workRoot, directory);
		assertRealDirectory(directory);
		const path = join(directory, file);
		assertContained(directory, path);
		return path;
	}
}

function resolveRepositoryContext(cwd: string): RepositoryContext {
	const root = git(cwd, ["rev-parse", "--show-toplevel"]);
	const commonDirectory = git(cwd, ["rev-parse", "--git-common-dir"]);
	const branch = git(cwd, ["branch", "--show-current"]) || "detached";
	const baseCommit = git(cwd, ["rev-parse", "HEAD"]);
	if (!root || !commonDirectory || !baseCommit) {
		throw new Error("Work Map requires a git repository with a base commit");
	}
	const canonicalCwd = realpathSync(root);
	const canonicalCommonDirectory = realpathSync(resolve(cwd, commonDirectory));
	const identity = canonicalCommonDirectory;
	return {
		identity,
		cwd: canonicalCwd,
		branch,
		baseCommit,
		repositoryId: createHash("sha256")
			.update(identity)
			.digest("hex")
			.slice(0, 24),
	};
}

export function renderWorkMapMarkdown(map: WorkMapV1): string {
	const lines = [
		`# ${map.destination}`,
		"",
		`- Work ID: \`${map.id}\``,
		`- Revision: ${map.revision}`,
		`- Status: \`${map.status}\``,
		`- Mode: \`${map.mode}\``,
		`- Repository: \`${map.repository.cwd}\``,
		`- Branch: \`${map.repository.branch}\``,
		`- Base commit: \`${map.repository.baseCommit}\``,
		"",
		"## Scope",
		"",
		"### Included",
		"",
		...bullets(map.scope.included),
		"",
		"### Excluded",
		"",
		...bullets(map.scope.excluded),
		"",
		"## Frontier",
		"",
		...bullets(map.frontier),
		"",
		"## Tickets",
		"",
		...map.tickets.flatMap((ticket) => [
			`### ${ticket.id}: ${ticket.title}`,
			"",
			`- Status: \`${ticket.status}\``,
			`- Delivers: ${ticket.delivers}`,
			`- Blocked by: ${ticket.blockedBy.length > 0 ? ticket.blockedBy.join(", ") : "none"}`,
			`- Verification: \`${ticket.verificationMode}\``,
			"",
			"Acceptance criteria:",
			"",
			...bullets(ticket.acceptanceCriteria),
			"",
			"Test seams:",
			"",
			...bullets(ticket.testSeams),
			"",
		]),
		"## Fog",
		"",
		...bullets(
			map.fog.map(
				(question) =>
					`${question.id} [${question.status}]: ${question.question}`,
			),
		),
		"",
		"## Decisions",
		"",
		...bullets(
			map.decisions.map((decision) =>
				decision.source
					? `${decision.id}: ${decision.summary} (${decision.source})`
					: `${decision.id}: ${decision.summary}`,
			),
		),
		"",
		"## Blockers",
		"",
		...bullets(
			map.blockers.map((blocker) => `${blocker.ticketId}: ${blocker.reason}`),
		),
		"",
	];
	return lines.join("\n");
}

function atomicWrite(path: string, content: string): void {
	assertNotSymlink(path, true);
	const directory = dirname(path);
	assertRealDirectory(directory);
	const temporary = join(
		directory,
		`.${path.split(sep).at(-1)}.tmp-${process.pid}-${randomUUID()}`,
	);
	assertContained(directory, temporary);
	try {
		writeFileSync(temporary, content, { mode: 0o600, flag: "wx" });
		renameSync(temporary, path);
	} finally {
		rmSync(temporary, { force: true });
	}
}

function acquireDirectoryLock(
	lock: string,
	busyMessage: string,
	timeoutMs: number,
): () => void {
	const deadline = Date.now() + timeoutMs;
	const token = randomUUID();
	const ownerPath = join(lock, "owner.json");
	while (true) {
		const candidate = `${lock}.candidate-${token}`;
		try {
			mkdirSync(candidate, { mode: 0o700 });
			try {
				writeFileSync(
					join(candidate, "owner.json"),
					stableJson({ schemaVersion: 1, pid: process.pid, token }),
					{ mode: 0o600, flag: "wx" },
				);
				renameSync(candidate, lock);
			} catch (error) {
				rmSync(candidate, { recursive: true, force: true });
				throw error;
			}
			return () => {
				const owner = parseLockOwner(
					JSON.parse(readFileSync(ownerPath, "utf8")),
				);
				if (owner.token !== token || owner.pid !== process.pid) {
					throw new Error(`Work Map lock ownership changed: ${lock}`);
				}
				const released = `${lock}.released-${token}`;
				renameSync(lock, released);
				rmSync(released, { recursive: true, force: true });
			};
		} catch (error) {
			rmSync(candidate, { recursive: true, force: true });
			if (!existsSync(lock)) throw error;
			assertRealDirectory(lock);
			if (recoverStaleLock(lock)) continue;
			if (timeoutMs === 0 || Date.now() >= deadline) {
				throw new Error(busyMessage);
			}
			sleepSync(ACTIVE_POINTER_LOCK_RETRY_MS);
		}
	}
}

function recoverStaleLock(lock: string): boolean {
	const ownerPath = join(lock, "owner.json");
	if (!existsSync(ownerPath)) {
		const stalePath = `${lock}.stale-${randomUUID()}`;
		renameSync(lock, stalePath);
		rmSync(stalePath, { recursive: true, force: true });
		return true;
	}
	assertNotSymlink(ownerPath);
	const owner = parseLockOwner(JSON.parse(readFileSync(ownerPath, "utf8")));
	if (processIsAlive(owner.pid)) return false;
	const stalePath = `${lock}.stale-${randomUUID()}`;
	renameSync(lock, stalePath);
	rmSync(stalePath, { recursive: true, force: true });
	return true;
}

function parseLockOwner(value: unknown): {
	schemaVersion: 1;
	pid: number;
	token: string;
} {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Work Map lock owner is invalid");
	}
	const owner = value as Record<string, unknown>;
	if (
		owner.schemaVersion !== 1 ||
		!Number.isSafeInteger(owner.pid) ||
		(owner.pid as number) < 1 ||
		typeof owner.token !== "string" ||
		owner.token.length === 0
	) {
		throw new Error("Work Map lock owner is invalid");
	}
	return owner as {
		schemaVersion: 1;
		pid: number;
		token: string;
	};
}

function processIsAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if (isNodeError(error) && error.code === "ESRCH") return false;
		if (isNodeError(error) && error.code === "EPERM") return true;
		throw error;
	}
}

function parseTransaction(value: unknown): WorkMapTransaction {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Work Map transaction is invalid");
	}
	const item = value as Record<string, unknown>;
	const map = parseWorkMap(item.map);
	const event = parseEvent(item.event);
	if (
		item.schemaVersion !== 1 ||
		(item.kind !== "create" && item.kind !== "update") ||
		(item.beforeDigest !== null &&
			(typeof item.beforeDigest !== "string" ||
				!/^[a-f0-9]{64}$/.test(item.beforeDigest))) ||
		typeof item.activate !== "boolean" ||
		event.workId !== map.id ||
		event.afterRevision !== map.revision ||
		event.digest !== workMapDigest(map)
	) {
		throw new Error("Work Map transaction is invalid");
	}
	if (
		(item.kind === "create" &&
			(item.beforeDigest !== null ||
				event.beforeRevision !== null ||
				!item.activate)) ||
		(item.kind === "update" &&
			(item.beforeDigest === null ||
				event.beforeRevision !== map.revision - 1 ||
				item.activate))
	) {
		throw new Error("Work Map transaction lifecycle is invalid");
	}
	return {
		schemaVersion: 1,
		kind: item.kind,
		beforeDigest: item.beforeDigest,
		map,
		event,
		activate: item.activate,
	};
}

function parseEvent(value: unknown): WorkMapEvent {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Work Map event is invalid");
	}
	const item = value as Record<string, unknown>;
	if (
		item.schemaVersion !== 1 ||
		typeof item.workId !== "string" ||
		!isValidWorkId(item.workId) ||
		typeof item.actor !== "string" ||
		item.actor.trim() === "" ||
		typeof item.operation !== "string" ||
		item.operation.trim() === "" ||
		(item.beforeRevision !== null &&
			(!Number.isSafeInteger(item.beforeRevision) ||
				(item.beforeRevision as number) < 1)) ||
		!Number.isSafeInteger(item.afterRevision) ||
		(item.afterRevision as number) < 1 ||
		typeof item.digest !== "string" ||
		!/^[a-f0-9]{64}$/.test(item.digest) ||
		typeof item.timestamp !== "string" ||
		Number.isNaN(Date.parse(item.timestamp))
	) {
		throw new Error("Work Map event is invalid");
	}
	return item as WorkMapEvent;
}

function secureStateRoot(root: string): string {
	const absolute = resolve(root);
	if (existsSync(absolute)) {
		assertRealDirectory(absolute);
		return realpathSync(absolute);
	}
	const parent = dirname(absolute);
	if (parent === absolute || !existsSync(parent)) {
		throw new Error(`Goldband state root parent does not exist: ${parent}`);
	}
	assertRealDirectory(parent);
	mkdirSync(absolute, { mode: 0o700 });
	assertRealDirectory(absolute);
	return realpathSync(absolute);
}

function secureDirectory(path: string): string {
	const parent = dirname(path);
	assertRealDirectory(parent);
	if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
	assertRealDirectory(path);
	return realpathSync(path);
}

function assertRealDirectory(path: string): void {
	if (!existsSync(path))
		throw new Error(`required directory is missing: ${path}`);
	const metadata = lstatSync(path);
	if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
		throw new Error(`state path must be a real directory: ${path}`);
	}
}

function assertNotSymlink(path: string, allowMissing = false): void {
	if (!existsSync(path)) {
		if (allowMissing) return;
		throw new Error(`Work Map state is missing: ${path}`);
	}
	if (lstatSync(path).isSymbolicLink()) {
		throw new Error(`refusing symbolic link state path: ${path}`);
	}
	if (!statSync(path).isFile() && !statSync(path).isDirectory()) {
		throw new Error(`unsupported Work Map state path: ${path}`);
	}
}

function assertContained(parent: string, target: string): void {
	const remainder = relative(parent, target);
	if (
		remainder === "" ||
		(!remainder.startsWith(`..${sep}`) &&
			remainder !== ".." &&
			!isAbsolute(remainder))
	) {
		return;
	}
	throw new Error(`Work Map path escapes state root: ${target}`);
}

function validWorkId(value: string): string {
	if (!isValidWorkId(value)) {
		throw new Error(`invalid Work Map id: ${value}`);
	}
	return value;
}

function isValidWorkId(value: string): boolean {
	return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value);
}

function nonEmpty(value: string, label: string): string {
	if (typeof value !== "string" || value.trim() === "") {
		throw new Error(`${label} must be a non-empty string`);
	}
	return value.trim();
}

function bullets(items: readonly string[]): string[] {
	return items.length > 0 ? items.map((item) => `- ${item}`) : ["- None"];
}

function git(cwd: string, args: string[]): string {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		timeout: 5_000,
	});
	return result.status === 0 ? result.stdout.trim() : "";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}

function sleepSync(milliseconds: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}
