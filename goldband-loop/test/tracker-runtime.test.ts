import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TrackerConfigurationStore } from "../workflows/tracker-config";
import { buildProjectionPlan, remoteProjectionDigest } from "../workflows/tracker-adapters/projection";
import { externalChangeCandidates } from "../workflows/tracker-adapters/import";
import { TrackerSyncStateStore } from "../workflows/tracker-adapters/sync-state";
import type {
	ExternalChangeCandidate,
	NativeApproval,
	ProjectionArtifact,
	ProjectionPlan,
	ProjectionPublishOptions,
	ProjectionResult,
	RemoteIssue,
	RemoteProjectionState,
	TrackerConfigurationReadback,
	TrackerProjectionAdapter,
} from "../workflows/tracker-adapters/types";
import { TrackerRuntime } from "../workflows/tracker-runtime";
import { WorkMapStore } from "../workflows/work-map-store";
import type { WorkMapV1 } from "../workflows/work-map";

const cleanup: string[] = [];
afterEach(() => { for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe("tracker runtime", () => {
	test("preview is local-only and publish requires the exact preview digest", async () => {
		const fixture = runtimeFixture();
		const plan = await fixture.runtime.preview(fixture.workId);
		expect(fixture.adapter.writeCount).toBe(0);
		await expect(fixture.runtime.publish({ workId: fixture.workId, operationDigest: "0".repeat(64), approval: () => {} })).rejects.toThrow("matching preview digest");
		expect(fixture.adapter.writeCount).toBe(0);
		const result = await fixture.runtime.publish({ workId: fixture.workId, operationDigest: plan.operationDigest, approval: () => {} });
		expect(result.status).toBe("completed");
		expect(result.pendingSteps).toEqual([]);
		const telemetry = readFileSync(join(fixture.state, "workflow-runs", "tracker-sync.jsonl"), "utf8");
		expect(telemetry).toContain('"provider":"github"');
		expect(telemetry).not.toContain("Ship tracker runtime");
	});

	test("checkpoints partial failure and resumes without duplicate writes", async () => {
		const fixture = runtimeFixture();
		const plan = await fixture.runtime.preview(fixture.workId);
		fixture.adapter.failStepOnce = plan.steps[2].id;
		const first = await fixture.runtime.publish({ workId: fixture.workId, operationDigest: plan.operationDigest, approval: () => {} });
		expect(first.status).toBe("pending");
		const firstWrites = fixture.adapter.writes.slice();
		const second = await fixture.runtime.publish({ workId: fixture.workId, operationDigest: plan.operationDigest, approval: () => {} });
		expect(second.status).toBe("completed");
		expect(firstWrites.every((step) => fixture.adapter.writes.filter((item) => item === step).length === 1)).toBe(true);
	});

	test("publishes exactly the approved next step", async () => {
		const fixture = runtimeFixture();
		const plan = await fixture.runtime.preview(fixture.workId);
		const first = await fixture.runtime.publishStep({ workId: fixture.workId, operationDigest: plan.operationDigest, stepId: plan.steps[0].id, approval: () => {} });
		expect(fixture.adapter.writes).toEqual([plan.steps[0].id]);
		expect(first.pendingSteps).toContain(plan.steps[1].id);
		await expect(fixture.runtime.publishStep({ workId: fixture.workId, operationDigest: plan.operationDigest, stepId: plan.steps[2].id, approval: () => {} })).rejects.toThrow("next pending");
	});

	test("remote drift blocks mutation and approval refusal leaves pending state", async () => {
		const fixture = runtimeFixture();
		const plan = await fixture.runtime.preview(fixture.workId);
		fixture.adapter.remote = emptyRemote("foreign-drift");
		await expect(fixture.runtime.publish({ workId: fixture.workId, operationDigest: plan.operationDigest, approval: () => {} })).rejects.toThrow("remote tracker changed");
		expect(fixture.adapter.writeCount).toBe(0);

		const fresh = runtimeFixture();
		const freshPlan = await fresh.runtime.preview(fresh.workId);
		const denied = await fresh.runtime.publish({ workId: fresh.workId, operationDigest: freshPlan.operationDigest, approval: () => { throw new Error("native approval denied"); } });
		expect(denied.status).toBe("pending");
		expect(denied.blockedReason).toBe("native approval denied");
		expect(fresh.adapter.writeCount).toBe(0);
	});

	test("readback mismatch remains pending", async () => {
		const fixture = runtimeFixture();
		const plan = await fixture.runtime.preview(fixture.workId);
		fixture.adapter.returnNoReadback = true;
		const result = await fixture.runtime.publish({ workId: fixture.workId, operationDigest: plan.operationDigest, approval: () => {} });
		expect(result.status).toBe("pending");
	});

	test("imports only an approved candidate bound to the inspected remote digest", async () => {
		const fixture = runtimeFixture();
		const plan = await fixture.runtime.preview(fixture.workId);
		await fixture.runtime.publish({ workId: fixture.workId, operationDigest: plan.operationDigest, approval: () => {} });
		const remote = fixture.adapter.remote as RemoteProjectionState;
		remote.ticketIssues["ticket-1"].state = "closed";
		const base = { provider: remote.provider, repository: remote.repository, workId: remote.workId, mapIssue: remote.mapIssue, ticketIssues: remote.ticketIssues };
		remote.digest = remoteProjectionDigest(base);
		const inspected = await fixture.runtime.inspect(fixture.workId);
		const candidate = inspected.candidates.find((item) => item.kind === "status") as ExternalChangeCandidate;
		await expect(fixture.runtime.applyApprovedChanges({ workId: fixture.workId, expectedRevision: 1, expectedRemoteDigest: "0".repeat(64), actor: "user", approved: [{ candidateId: candidate.id, operation: { kind: "block-ticket", reason: "remote issue closed" } }] })).rejects.toThrow("remote tracker changed");
		const updated = await fixture.runtime.applyApprovedChanges({ workId: fixture.workId, expectedRevision: 1, expectedRemoteDigest: inspected.remoteDigest, actor: "user", approved: [{ candidateId: candidate.id, operation: { kind: "block-ticket", reason: "remote issue closed" } }] });
		expect(updated.tickets[0].status).toBe("blocked");
		expect(updated.tickets[0].status).not.toBe("verified");
	});

	test("applies an assignee claim only through an explicit matching lease binding", async () => {
		const fixture = runtimeFixture(true);
		const plan = await fixture.runtime.preview(fixture.workId);
		await fixture.runtime.publish({ workId: fixture.workId, operationDigest: plan.operationDigest, approval: () => {} });
		const remote = fixture.adapter.remote as RemoteProjectionState;
		remote.ticketIssues["ticket-1"].assignees = ["alice"];
		remote.digest = remoteProjectionDigest({ provider: remote.provider, repository: remote.repository, workId: remote.workId, mapIssue: remote.mapIssue, ticketIssues: remote.ticketIssues });
		const inspected = await fixture.runtime.inspect(fixture.workId);
		const candidate = inspected.candidates.find((item) => item.kind === "assignee") as ExternalChangeCandidate;
		await expect(fixture.runtime.applyApprovedChanges({ workId: fixture.workId, expectedRevision: 1, expectedRemoteDigest: inspected.remoteDigest, actor: "reviewer", approved: [{ candidateId: candidate.id, operation: { kind: "claim-ticket", owner: "mallory", leaseId: "analysis-1", bindingKind: "analysis" } }] })).rejects.toThrow("does not match candidate");
		const claimed = await fixture.runtime.applyApprovedChanges({ workId: fixture.workId, expectedRevision: 1, expectedRemoteDigest: inspected.remoteDigest, actor: "reviewer", approved: [{ candidateId: candidate.id, operation: { kind: "claim-ticket", owner: "alice", leaseId: "analysis-1", bindingKind: "analysis" } }] });
		expect(claimed.tickets[0].claim).toMatchObject({ owner: "alice", leaseId: "analysis-1", kind: "analysis" });
	});
});

class FakeAdapter implements TrackerProjectionAdapter {
	readonly provider = "github" as const;
	remote: RemoteProjectionState | null = null;
	writes: string[] = [];
	failStepOnce = "";
	returnNoReadback = false;

	get writeCount() { return this.writes.length; }
	async inspectConfiguration(): Promise<TrackerConfigurationReadback> { return { provider: "github", repository: "owner/repo", cliAvailable: true, authenticated: true, repositoryAccessible: true, dependencyCapability: "body-links" }; }
	async previewProjection(map: WorkMapV1): Promise<ProjectionPlan> { return buildProjectionPlan({ provider: "github", repository: "owner/repo", map, remote: this.remote, operationId: "operation-1" }); }
	async inspectRemote(): Promise<RemoteProjectionState> {
		if (!this.remote || (this.returnNoReadback && this.writes.length > 0)) throw new Error("tracker projection not found");
		return this.remote;
	}
	diff(map: WorkMapV1, remote: RemoteProjectionState): ExternalChangeCandidate[] { return externalChangeCandidates(map, remote); }
	async publish(plan: ProjectionPlan, approval: NativeApproval, options: ProjectionPublishOptions = {}): Promise<ProjectionResult> {
		const completed = [...(options.completedSteps ?? [])];
		for (const step of plan.steps) {
			if (completed.includes(step.id)) continue;
			if (options.onlyStepId && step.id !== options.onlyStepId) continue;
			const artifact = plan.artifacts.find((item) => item.stepId === step.artifactStepId) as ProjectionArtifact;
			try {
				await approval({ provider: "github", repository: "owner/repo", operationId: plan.operationId, stepId: step.id, action: step.action, artifact });
				if (this.failStepOnce === step.id) { this.failStepOnce = ""; throw new Error("simulated provider failure"); }
				this.writes.push(step.id);
				this.applyArtifact(artifact);
				completed.push(step.id);
			} catch (error) {
				return { status: "pending", operationId: plan.operationId, completedSteps: completed, pendingSteps: plan.steps.filter((item) => !completed.includes(item.id)).map((item) => item.id), remote: this.returnNoReadback ? null : this.remote, blockedReason: error instanceof Error ? error.message : String(error) };
			}
			if (options.onlyStepId) break;
		}
		const pendingSteps = plan.steps.filter((item) => !completed.includes(item.id)).map((item) => item.id);
		return { status: pendingSteps.length ? "pending" : "completed", operationId: plan.operationId, completedSteps: completed, pendingSteps, remote: this.returnNoReadback ? null : this.remote };
	}

	private applyArtifact(artifact: ProjectionArtifact) {
		const current = this.remote ?? emptyRemote();
		const issue: RemoteIssue = { id: artifact.kind === "map" ? "1" : artifact.ticketId === "ticket-1" ? "2" : "3", url: "https://tracker.test", title: artifact.title, body: artifact.body, state: artifact.state, labels: artifact.labels, assignees: [], comments: [] };
		if (artifact.kind === "map") current.mapIssue = issue;
		else current.ticketIssues[artifact.ticketId as string] = issue;
		const base = { provider: current.provider, repository: current.repository, workId: current.workId, mapIssue: current.mapIssue, ticketIssues: current.ticketIssues };
		this.remote = { ...base, digest: remoteProjectionDigest(base) };
	}
}

function runtimeFixture(analysisFirst = false) {
	const repository = mkdtempSync(join(tmpdir(), "tracker-runtime-repo-")); cleanup.push(repository);
	git(repository, ["init", "-b", "dev"]); git(repository, ["config", "user.name", "Test"]); git(repository, ["config", "user.email", "test@example.com"]);
	git(repository, ["commit", "--allow-empty", "-m", "initial"]);
	const state = mkdtempSync(join(tmpdir(), "tracker-runtime-state-")); cleanup.push(state);
	const workMaps = new WorkMapStore({ cwd: repository, goldbandHome: state, idFactory: () => "work-1", clock: () => new Date("2026-08-01T00:00:00Z") });
	const map = workMaps.create({
		mode: "wayfinding", destination: "Ship tracker runtime", scope: { included: ["tracker"], excluded: ["Jira"] }, decisions: [], fog: [],
		tickets: [
			{ id: "ticket-1", title: "Projection", delivers: "Projection", blockedBy: [], acceptanceCriteria: ["works"], verificationMode: analysisFirst ? "analysis-only" : "existing-tests", ...(analysisFirst ? { analysisArtifact: "reports/projection.md" } : { verificationCommand: ["bun", "test"] }), testSeams: analysisFirst ? [] : ["projection"], status: "ready" },
			{ id: "ticket-2", title: "Runtime", delivers: "Runtime", blockedBy: ["ticket-1"], acceptanceCriteria: ["resumes"], verificationMode: "existing-tests", verificationCommand: ["bun", "test"], testSeams: ["runtime"], status: "ready" },
		],
	}, "test");
	const configuration = new TrackerConfigurationStore(state);
	configuration.write({ schemaVersion: 1, mode: "github", repository: "owner/repo", defaultLabels: [], dependencyCapability: "body-links" });
	const adapter = new FakeAdapter();
	const runtime = new TrackerRuntime({ cwd: repository, goldbandHome: state, configurationStore: configuration, syncStateStore: new TrackerSyncStateStore(state), workMapStore: workMaps, adapterFactory: () => adapter, clock: () => new Date("2026-08-02T00:00:00Z") });
	return { adapter, runtime, workId: map.id, state };
}

function emptyRemote(digest?: string): RemoteProjectionState {
	const base = { provider: "github" as const, repository: "owner/repo", workId: "work-1", mapIssue: null, ticketIssues: {} };
	return { ...base, digest: digest ?? remoteProjectionDigest(base) };
}

function git(cwd: string, args: string[]) {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" });
	if (result.status !== 0) throw new Error(result.stderr);
}
