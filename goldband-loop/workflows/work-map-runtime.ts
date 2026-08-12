import {
	calculateBlockers,
	calculateFrontier,
	parseWorkMap,
	parseWorkMapCreateInput,
	workMapDigest,
	type WorkMapCreateInput,
	type WorkMapV1,
} from "./work-map";
import { WorkMapStore } from "./work-map-store";
import type { WorkflowContext } from "./types";

export type WorkMapRuntimeResult = {
	owner: "work-map-store";
	operation: "create";
	status: "completed";
	summary: string;
	evidence: string[];
	artifacts: string[];
	workId: string;
	revision: number;
	digest: string;
	frontier: string[];
	map: WorkMapV1;
	mock: boolean;
};

export type WorkMapLifecycleResult = {
	owner: "work-map-store";
	operation: "block" | "resume" | "cancel";
	status: "completed";
	workId: string;
	ticketId: string;
	revision: number;
	map: WorkMapV1;
};

export function executeWorkMapLifecycle(
	operation: "block" | "resume" | "cancel",
	input: { workId: string; ticketId: string; reason: string },
	options: {
		host: "claude" | "codex";
		cwd: string;
		goldbandHome?: string;
	},
): WorkMapLifecycleResult {
	const workId = requiredLifecycleValue(input.workId, "work id");
	const ticketId = requiredLifecycleValue(input.ticketId, "ticket id");
	const reason =
		operation === "resume" ? input.reason.trim() : requiredLifecycleValue(input.reason, "reason");
	const store = new WorkMapStore({
		cwd: options.cwd,
		goldbandHome: options.goldbandHome,
	});
	const current = store.read(workId);
	const mutation = {
		workId,
		ticketId,
		expectedRevision: current.revision,
		actor: `${options.host}-plan-${operation}`,
		reason,
	};
	const map = operation === "block"
		? store.blockTicket(mutation)
		: operation === "cancel"
			? store.cancelTicket(mutation)
			: store.resumeTicket({
					workId,
					ticketId,
					expectedRevision: current.revision,
					actor: `${options.host}-plan-resume`,
				});
	return {
		owner: "work-map-store",
		operation,
		status: "completed",
		workId,
		ticketId,
		revision: map.revision,
		map: store.read(workId),
	};
}

export function runWorkMapCreate(ctx: WorkflowContext): WorkMapRuntimeResult {
	const result = executeWorkMapCreate(ctx.input, {
		mode: ctx.options.mode ?? "mock",
		host: ctx.options.host ?? "mock",
		cwd: ctx.cwd,
		goldbandHome: ctx.options.goldbandHome,
	});
	ctx.artifacts.push(...result.artifacts);
	return result;
}

export function executeWorkMapCreate(
	rawInput: unknown,
	options: {
		mode: "mock" | "real";
		host: "mock" | "claude" | "codex";
		cwd: string;
		goldbandHome?: string;
	},
): WorkMapRuntimeResult {
	const input =
		options.mode === "real"
			? parseWorkMapCreateInput(rawInput)
			: parseWorkMapCreateInput(rawInput ?? mockCreateInput());
	if (options.mode !== "real") {
		const map = mockMap(input);
		return {
			owner: "work-map-store",
			operation: "create",
			status: "completed",
			summary: "Validated deterministic mock Work Map without persistence.",
			evidence: ["mock=true", `digest=${workMapDigest(map)}`],
			artifacts: [],
			workId: map.id,
			revision: map.revision,
			digest: workMapDigest(map),
			frontier: map.frontier,
			map,
			mock: true,
		};
	}
	const host = options.host;
	if (host !== "claude" && host !== "codex") {
		throw new Error("plan/create real mode requires host claude or codex");
	}
	const store = new WorkMapStore({
		cwd: options.cwd,
		goldbandHome: options.goldbandHome,
	});
	const map = store.create(input, host);
	const artifacts = [
		store.mapPath(map.id),
		store.markdownPath(map.id),
		store.eventsPath(map.id),
		store.activePath,
	];
	return {
		owner: "work-map-store",
		operation: "create",
		status: "completed",
		summary: "Created and read back the active Work Map.",
		evidence: [
			`workId=${map.id}`,
			`revision=${map.revision}`,
			`digest=${workMapDigest(map)}`,
			`frontier=${map.frontier.join(",") || "(empty)"}`,
		],
		artifacts,
		workId: map.id,
		revision: map.revision,
		digest: workMapDigest(map),
		frontier: map.frontier,
		map: store.read(map.id),
		mock: false,
	};
}

function mockCreateInput(): WorkMapCreateInput {
	return {
		mode: "bounded",
		destination: "Validate the Work Map runtime contract",
		scope: {
			included: ["Work Map schema and deterministic frontier"],
			excluded: ["External issue tracker synchronization"],
		},
		decisions: [],
		fog: [],
		tickets: [
			{
				id: "ticket-foundation",
				title: "Validate the foundation",
				delivers: "A deterministic mock Work Map",
				blockedBy: [],
				acceptanceCriteria: ["The Work Map passes strict validation"],
				verificationMode: "existing-tests",
				verificationCommand: ["bun", "test"],
				testSeams: ["work-map runtime test"],
				status: "ready",
			},
		],
	};
}

function requiredLifecycleValue(value: string, label: string): string {
	const normalized = value.trim();
	if (!normalized || normalized.length > 1024 || /[\u0000-\u001f\u007f]/.test(normalized)) {
		throw new Error(`Work Map ${label} is invalid`);
	}
	return normalized;
}

function mockMap(input: WorkMapCreateInput): WorkMapV1 {
	return parseWorkMap({
		schemaVersion: 1,
		id: "mock-work-map",
		revision: 1,
		createdAt: "2000-01-01T00:00:00.000Z",
		updatedAt: "2000-01-01T00:00:00.000Z",
		repository: {
			identity: "mock-repository",
			cwd: "/mock/repository",
			branch: "mock",
			baseCommit: "mock",
		},
		status: "mapped",
		...input,
		frontier: calculateFrontier(input.tickets),
		blockers: calculateBlockers(input.tickets),
	});
}
