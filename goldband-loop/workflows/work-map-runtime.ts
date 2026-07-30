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
				testSeams: ["work-map runtime test"],
				status: "ready",
			},
		],
	};
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
