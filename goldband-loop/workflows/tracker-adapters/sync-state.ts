import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveGoldbandStateRoot } from "../../lib/state-root";
import { secureTrackerStateDirectory } from "../tracker-config";
import type { TrackerProvider } from "./types";

export type TrackerSyncStateV1 = {
	schemaVersion: 1;
	provider: TrackerProvider;
	repository: string;
	workId: string;
	mapRemoteId: string;
	ticketRemoteIds: Record<string, string>;
	lastLocalRevision: number;
	lastRemoteDigest: string;
	checkpoint: {
		operationId: string;
		operationDigest: string;
		completedSteps: string[];
		pendingSteps: string[];
	};
	lastReadbackAt: string;
};

export function parseTrackerSyncState(value: unknown): TrackerSyncStateV1 {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("tracker sync state must be an object");
	const item = value as Record<string, unknown>;
	const allowed = new Set(["schemaVersion", "provider", "repository", "workId", "mapRemoteId", "ticketRemoteIds", "lastLocalRevision", "lastRemoteDigest", "checkpoint", "lastReadbackAt"]);
	if (Object.keys(item).some((key) => !allowed.has(key)) || Object.keys(item).length !== allowed.size) throw new Error("invalid tracker sync state fields");
	if (item.schemaVersion !== 1) throw new Error("unsupported tracker sync state schema");
	if (item.provider !== "github" && item.provider !== "gitlab") throw new Error("invalid tracker provider");
	const checkpoint = record(item.checkpoint, "checkpoint");
	const remoteIds = record(item.ticketRemoteIds, "ticketRemoteIds");
	return {
		schemaVersion: 1,
		provider: item.provider,
		repository: repository(item.repository),
		workId: id(item.workId, "workId"),
		mapRemoteId: id(item.mapRemoteId, "mapRemoteId", true),
		ticketRemoteIds: Object.fromEntries(Object.entries(remoteIds).map(([key, value]) => [id(key, "ticketId"), id(value, "remoteId")])),
		lastLocalRevision: positiveInteger(item.lastLocalRevision, "lastLocalRevision"),
		lastRemoteDigest: digest(item.lastRemoteDigest, "lastRemoteDigest", true),
		checkpoint: {
			operationId: id(checkpoint.operationId, "operationId"),
			operationDigest: digest(checkpoint.operationDigest, "operationDigest"),
			completedSteps: uniqueStrings(checkpoint.completedSteps, "completedSteps"),
			pendingSteps: uniqueStrings(checkpoint.pendingSteps, "pendingSteps"),
		},
		lastReadbackAt: timestamp(item.lastReadbackAt, "lastReadbackAt"),
	};
}

export class TrackerSyncStateStore {
	readonly root: string;

	constructor(goldbandHome?: string) {
		const stateRoot = secureTrackerStateDirectory(resolveGoldbandStateRoot(goldbandHome));
		this.root = secureTrackerStateDirectory(join(stateRoot, "tracker-sync"));
	}

	read(workId: string): TrackerSyncStateV1 | null {
		const path = this.path(workId);
		if (!existsSync(path)) return null;
		if (lstatSync(path).isSymbolicLink()) throw new Error("tracker sync state must not be a symbolic link");
		return parseTrackerSyncState(JSON.parse(readFileSync(path, "utf8")));
	}

	write(state: TrackerSyncStateV1): void {
		const parsed = parseTrackerSyncState(state);
		const path = this.path(parsed.workId);
		mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
		const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
		writeFileSync(temporary, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600, flag: "wx" });
		renameSync(temporary, path);
	}

	path(workId: string): string {
		return join(this.root, `${id(workId, "workId")}.json`);
	}
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
	return value as Record<string, unknown>;
}

function id(value: unknown, label: string, empty = false): string {
	if (empty && value === "") return "";
	if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value)) throw new Error(`invalid ${label}`);
	return value;
}

function repository(value: unknown): string {
	if (typeof value !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) throw new Error("invalid repository");
	return value;
}

function digest(value: unknown, label: string, empty = false): string {
	if (empty && value === "") return "";
	if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`invalid ${label}`);
	return value;
}

function positiveInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error(`${label} must be a positive integer`);
	return value as number;
}

function uniqueStrings(value: unknown, label: string): string[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0) || new Set(value).size !== value.length) throw new Error(`${label} must contain unique non-empty strings`);
	return value as string[];
}

function timestamp(value: unknown, label: string): string {
	if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new Error(`invalid ${label}`);
	return value;
}
