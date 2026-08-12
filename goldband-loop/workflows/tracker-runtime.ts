import {
	existsSync,
	lstatSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { resolveGoldbandStateRoot } from "../lib/state-root";
import {
	secureTrackerStateDirectory,
	TrackerConfigurationStore,
	type TrackerConfigurationV1,
} from "./tracker-config";
import { GitHubTrackerAdapter } from "./tracker-adapters/github";
import { GitLabTrackerAdapter } from "./tracker-adapters/gitlab";
import { projectionDigest } from "./tracker-adapters/projection";
import {
	TrackerSyncStateStore,
	type TrackerSyncStateV1,
} from "./tracker-adapters/sync-state";
import type {
	ApprovedExternalChange,
	ExternalChangeCandidate,
	NativeApproval,
	ProjectionPlan,
	RemoteProjectionState,
	TrackerCommandRunner,
	TrackerProjectionAdapter,
} from "./tracker-adapters/types";
import { runTrackerCommand } from "./tracker-config";
import { WorkMapStore } from "./work-map-store";
import type { WorkMapV1 } from "./work-map";
import { writeTrackerTelemetry } from "./evidence";

export type TrackerRuntimeOptions = {
	cwd: string;
	goldbandHome?: string;
	commandRunner?: TrackerCommandRunner;
	configurationStore?: TrackerConfigurationStore;
	syncStateStore?: TrackerSyncStateStore;
	adapterFactory?: (
		configuration: TrackerConfigurationV1 & {
			mode: "github" | "gitlab";
			repository: string;
		},
	) => TrackerProjectionAdapter;
	workMapStore?: WorkMapStore;
	clock?: () => Date;
};

export class TrackerRuntime {
	readonly #workMaps: WorkMapStore;
	readonly #configuration: TrackerConfigurationStore;
	readonly #syncStates: TrackerSyncStateStore;
	readonly #previews: TrackerPreviewStore;
	readonly #runner: TrackerCommandRunner;
	readonly #adapterFactory?: TrackerRuntimeOptions["adapterFactory"];
	readonly #clock: () => Date;
	readonly #goldbandHome?: string;

	constructor(options: TrackerRuntimeOptions) {
		this.#workMaps =
			options.workMapStore ??
			new WorkMapStore({
				cwd: options.cwd,
				goldbandHome: options.goldbandHome,
			});
		this.#configuration =
			options.configurationStore ??
			new TrackerConfigurationStore(options.goldbandHome);
		this.#syncStates =
			options.syncStateStore ?? new TrackerSyncStateStore(options.goldbandHome);
		this.#previews = new TrackerPreviewStore(options.goldbandHome);
		this.#runner = options.commandRunner ?? runTrackerCommand;
		this.#adapterFactory = options.adapterFactory;
		this.#clock = options.clock ?? (() => new Date());
		this.#goldbandHome = options.goldbandHome;
	}

	async preview(workId: string): Promise<ProjectionPlan> {
		const started = performance.now();
		const map = this.#workMaps.read(workId);
		const adapter = this.#adapter();
		const plan = await adapter.previewProjection(map);
		this.#previews.write(plan);
		writeTrackerTelemetry(
			{
				provider: plan.provider,
				operation: "preview",
				artifactCount: plan.artifacts.length,
				completedCount: 0,
				pendingCount: plan.steps.length,
				status: "completed",
				durationMs: performance.now() - started,
			},
			{ goldbandHome: this.#goldbandHome },
		);
		return plan;
	}

	async publish(input: {
		workId: string;
		operationDigest: string;
		approval: NativeApproval;
	}): Promise<{
		status: "completed" | "pending";
		plan: ProjectionPlan;
		remote: RemoteProjectionState | null;
		completedSteps: string[];
		pendingSteps: string[];
		blockedReason?: string;
		checkpoint: TrackerSyncStateV1["checkpoint"] & { lastRemoteDigest: string };
	}> {
		return this.#publish(input);
	}

	async publishStep(input: {
		workId: string;
		operationDigest: string;
		stepId: string;
		approval: NativeApproval;
	}): Promise<Awaited<ReturnType<TrackerRuntime["publish"]>>> {
		if (!input.stepId) throw new Error("publish step requires a step ID");
		return this.#publish(input);
	}

	async #publish(input: {
		workId: string;
		operationDigest: string;
		approval: NativeApproval;
		stepId?: string;
	}): Promise<{
		status: "completed" | "pending";
		plan: ProjectionPlan;
		remote: RemoteProjectionState | null;
		completedSteps: string[];
		pendingSteps: string[];
		blockedReason?: string;
		checkpoint: TrackerSyncStateV1["checkpoint"] & { lastRemoteDigest: string };
	}> {
		const started = performance.now();
		const plan = this.#previews.read(input.workId);
		if (plan.operationDigest !== input.operationDigest)
			throw new Error("publish requires the matching preview digest");
		const map = this.#workMaps.read(input.workId);
		if (map.revision !== plan.localRevision)
			throw new Error("local Work Map changed after preview");
		const adapter = this.#adapter();
		const prior = this.#syncStates.read(input.workId);
		const remoteBefore = await inspectOptional(adapter, input.workId);
		const expectedRemoteDigest =
			prior?.checkpoint.operationDigest === plan.operationDigest
				? prior.lastRemoteDigest || null
				: plan.remoteDigest;
		if ((remoteBefore?.digest ?? null) !== expectedRemoteDigest) {
			writeTrackerTelemetry(
				{
					provider: plan.provider,
					operation: "publish",
					artifactCount: plan.artifacts.length,
					completedCount: 0,
					pendingCount: plan.steps.length,
					status: "blocked",
					durationMs: performance.now() - started,
					conflictReason: "remote-digest-changed",
				},
				{ goldbandHome: this.#goldbandHome },
			);
			throw new Error("remote tracker changed after preview");
		}
		const completed =
			prior?.checkpoint.operationDigest === plan.operationDigest
				? prior.checkpoint.completedSteps
				: [];
		if (input.stepId) {
			const nextPending = plan.steps.find(
				(step) => !completed.includes(step.id),
			);
			if (nextPending?.id !== input.stepId)
				throw new Error(
					`publish step must be the next pending projection step: ${nextPending?.id ?? "none"}`,
				);
		}
		const result = await adapter.publish(plan, input.approval, {
			completedSteps: completed,
			...(input.stepId ? { onlyStepId: input.stepId } : {}),
		});
		const completedSteps = [...new Set(result.completedSteps)];
		const pendingSteps = plan.steps
			.filter((step) => !completedSteps.includes(step.id))
			.map((step) => step.id);
		const remote =
			result.remote ?? (await inspectOptional(adapter, input.workId));
		this.#syncStates.write(
			syncStateFrom(plan, remote, completedSteps, pendingSteps, this.#clock()),
		);
		const persisted = this.#syncStates.read(input.workId);
		if (
			!persisted ||
			persisted.checkpoint.operationDigest !== plan.operationDigest
		) {
			throw new Error("tracker sync checkpoint readback mismatch");
		}
		writeTrackerTelemetry(
			{
				provider: plan.provider,
				operation: "publish",
				artifactCount: plan.artifacts.length,
				completedCount: completedSteps.length,
				pendingCount: pendingSteps.length,
				status: pendingSteps.length === 0 && remote ? "completed" : "pending",
				durationMs: performance.now() - started,
				...(result.blockedReason
					? { conflictReason: result.blockedReason }
					: {}),
			},
			{ goldbandHome: this.#goldbandHome },
		);
		return {
			status: pendingSteps.length === 0 && remote ? "completed" : "pending",
			plan,
			remote,
			completedSteps,
			pendingSteps,
			checkpoint: {
				...persisted.checkpoint,
				lastRemoteDigest: persisted.lastRemoteDigest,
			},
			...(result.blockedReason ? { blockedReason: result.blockedReason } : {}),
		};
	}

	async inspect(workId: string): Promise<{
		map: WorkMapV1;
		remote: RemoteProjectionState;
		localRevision: number;
		remoteDigest: string;
		checkpointMatches: boolean;
		candidates: ExternalChangeCandidate[];
	}> {
		const started = performance.now();
		const map = this.#workMaps.read(workId);
		const adapter = this.#adapter();
		const remote = await adapter.inspectRemote(workId);
		const checkpoint = this.#syncStates.read(workId);
		const result = {
			map,
			remote,
			localRevision: map.revision,
			remoteDigest: remote.digest,
			checkpointMatches:
				checkpoint?.lastLocalRevision === map.revision &&
				checkpoint.lastRemoteDigest === remote.digest,
			candidates: adapter.diff(map, remote),
		};
		writeTrackerTelemetry(
			{
				provider: remote.provider,
				operation: "inspect",
				artifactCount: 1 + Object.keys(remote.ticketIssues).length,
				completedCount: 0,
				pendingCount: result.candidates.length,
				status: "completed",
				durationMs: performance.now() - started,
			},
			{ goldbandHome: this.#goldbandHome },
		);
		return result;
	}

	async applyApprovedChanges(input: {
		workId: string;
		expectedRevision: number;
		expectedRemoteDigest: string;
		actor: string;
		approved: ApprovedExternalChange[];
	}): Promise<WorkMapV1> {
		const inspected = await this.inspect(input.workId);
		if (inspected.map.revision !== input.expectedRevision)
			throw new Error("stale Work Map revision for external import");
		if (inspected.remoteDigest !== input.expectedRemoteDigest)
			throw new Error("remote tracker changed after external change approval");
		if (
			new Set(input.approved.map((item) => item.candidateId)).size !==
			input.approved.length
		)
			throw new Error("external import contains duplicate approvals");
		const known = new Map(
			inspected.candidates.map((candidate) => [candidate.id, candidate]),
		);
		let map = inspected.map;
		for (const approved of input.approved) {
			const candidate = known.get(approved.candidateId);
			if (!candidate || !candidate.ticketId)
				throw new Error(
					`external candidate is missing or cannot mutate a ticket: ${approved.candidateId}`,
				);
			if (!operationMatchesCandidate(candidate, approved))
				throw new Error(
					`approved operation does not match candidate: ${approved.candidateId}`,
				);
			if (approved.operation.kind === "claim-ticket") {
				map = this.#workMaps.claimTicket({
					workId: input.workId,
					ticketId: candidate.ticketId,
					expectedRevision: map.revision,
					owner: approved.operation.owner,
					leaseId: approved.operation.leaseId,
					kind: "analysis",
				});
				continue;
			}
			map = this.#workMaps.applyApprovedExternalChange({
				workId: input.workId,
				ticketId: candidate.ticketId,
				expectedRevision: map.revision,
				actor: input.actor,
				change: approved.operation,
			});
		}
		return map;
	}

	async syncApprovedChanges(input: {
		workId: string;
		expectedRevision: number;
		expectedRemoteDigest: string;
		actor: string;
		approved: ApprovedExternalChange[];
		approval: NativeApproval;
	}): Promise<Awaited<ReturnType<TrackerRuntime["publish"]>>> {
		await this.applyApprovedChanges(input);
		const plan = await this.preview(input.workId);
		return this.publish({
			workId: input.workId,
			operationDigest: plan.operationDigest,
			approval: input.approval,
		});
	}

	#adapter(): TrackerProjectionAdapter {
		const configuration = this.#configuration.read();
		if (configuration.mode === "off" || !configuration.repository)
			throw new Error("tracker mode is off");
		const active = {
			...configuration,
			mode: configuration.mode,
			repository: configuration.repository,
		};
		if (this.#adapterFactory) return this.#adapterFactory(active);
		const common = {
			repository: active.repository,
			runner: this.#runner,
			defaultLabels: active.defaultLabels,
			dependencyCapability: active.dependencyCapability,
		};
		return active.mode === "github"
			? new GitHubTrackerAdapter(common)
			: new GitLabTrackerAdapter(common);
	}
}

class TrackerPreviewStore {
	readonly root: string;

	constructor(goldbandHome?: string) {
		const stateRoot = secureTrackerStateDirectory(
			resolveGoldbandStateRoot(goldbandHome),
		);
		const trackerRoot = secureTrackerStateDirectory(join(stateRoot, "tracker"));
		this.root = secureTrackerStateDirectory(join(trackerRoot, "previews"));
	}

	read(workId: string): ProjectionPlan {
		const path = this.path(workId);
		if (!existsSync(path)) throw new Error("tracker preview not found");
		if (lstatSync(path).isSymbolicLink())
			throw new Error("tracker preview must not be a symbolic link");
		const plan = JSON.parse(readFileSync(path, "utf8")) as ProjectionPlan;
		const { operationDigest, ...unsigned } = plan;
		if (projectionDigest(unsigned) !== operationDigest)
			throw new Error("stored tracker preview digest mismatch");
		return plan;
	}

	write(plan: ProjectionPlan): void {
		const path = this.path(plan.workId);
		const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
		writeFileSync(temporary, `${JSON.stringify(plan, null, 2)}\n`, {
			mode: 0o600,
			flag: "wx",
		});
		renameSync(temporary, path);
	}

	path(workId: string): string {
		if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(workId))
			throw new Error("invalid Work Map ID");
		return join(this.root, `${workId}.json`);
	}
}

function syncStateFrom(
	plan: ProjectionPlan,
	remote: RemoteProjectionState | null,
	completedSteps: string[],
	pendingSteps: string[],
	clock: Date,
): TrackerSyncStateV1 {
	return {
		schemaVersion: 1,
		provider: plan.provider,
		repository: plan.repository,
		workId: plan.workId,
		mapRemoteId: remote?.mapIssue?.id ?? "",
		ticketRemoteIds: Object.fromEntries(
			Object.entries(remote?.ticketIssues ?? {}).map(([ticketId, issue]) => [
				ticketId,
				issue.id,
			]),
		),
		lastLocalRevision: plan.localRevision,
		lastRemoteDigest: remote?.digest ?? "",
		checkpoint: {
			operationId: plan.operationId,
			operationDigest: plan.operationDigest,
			completedSteps,
			pendingSteps,
		},
		lastReadbackAt: clock.toISOString(),
	};
}

function operationMatchesCandidate(
	candidate: ExternalChangeCandidate,
	approved: ApprovedExternalChange,
): boolean {
	if (
		candidate.kind === "assignee" &&
		approved.operation.kind === "claim-ticket"
	) {
		return (
			Array.isArray(candidate.remoteValue) &&
			candidate.remoteValue.length === 1 &&
			candidate.remoteValue[0] === approved.operation.owner
		);
	}
	if (
		candidate.kind === "resolution-comment" &&
		typeof candidate.remoteValue === "string"
	) {
		const requested =
			/^goldband-resolution:\s*(block|resume|cancel)(?:\s+(.+))?$/i
				.exec(candidate.remoteValue.trim())?.[1]
				?.toLowerCase();
		return requested === approved.operation.kind.replace("-ticket", "");
	}
	if (candidate.kind === "status") {
		if (candidate.remoteValue === "open")
			return approved.operation.kind === "resume-ticket";
		if (candidate.remoteValue === "closed")
			return (
				approved.operation.kind === "block-ticket" ||
				approved.operation.kind === "cancel-ticket"
			);
	}
	return false;
}

async function inspectOptional(
	adapter: TrackerProjectionAdapter,
	workId: string,
): Promise<RemoteProjectionState | null> {
	try {
		return await adapter.inspectRemote(workId);
	} catch (error) {
		if (
			error instanceof Error &&
			error.message === "tracker projection not found"
		)
			return null;
		throw error;
	}
}
