import type { WorkMapV1 } from "../work-map";

export type TrackerProvider = "github" | "gitlab";
type TrackerArtifactKind = "map" | "ticket";
type TrackerIssueState = "open" | "closed";

export type TrackerConfigurationReadback = {
	provider: TrackerProvider;
	repository: string;
	cliAvailable: boolean;
	authenticated: boolean;
	repositoryAccessible: boolean;
	dependencyCapability: "native" | "body-links";
	blockedReason?: string;
};

export type ProjectionArtifact = {
	stepId: string;
	kind: TrackerArtifactKind;
	workId: string;
	ticketId?: string;
	title: string;
	body: string;
	digest: string;
	labels: string[];
	state: TrackerIssueState;
	blockedByTicketIds: string[];
	remoteId?: string;
};

export type ProjectionPlan = {
	schemaVersion: 1;
	provider: TrackerProvider;
	repository: string;
	workId: string;
	localRevision: number;
	operationId: string;
	operationDigest: string;
	remoteDigest: string | null;
	artifacts: ProjectionArtifact[];
	steps: Array<{
		id: string;
		action: "create" | "update" | "close" | "reopen" | "link";
		artifactStepId: string;
		requiresApproval: true;
	}>;
};

export type RemoteComment = {
	id: string;
	author: string;
	createdAt: string;
	body: string;
};

export type RemoteIssue = {
	id: string;
	url: string;
	title: string;
	body: string;
	state: TrackerIssueState;
	labels: string[];
	assignees: string[];
	comments: RemoteComment[];
};

export type RemoteProjectionState = {
	provider: TrackerProvider;
	repository: string;
	workId: string;
	mapIssue: RemoteIssue | null;
	ticketIssues: Record<string, RemoteIssue>;
	digest: string;
};

export type ProjectionResult = {
	status: "completed" | "pending" | "blocked";
	operationId: string;
	completedSteps: string[];
	pendingSteps: string[];
	remote: RemoteProjectionState | null;
	blockedReason?: string;
};

type ExternalChangeKind =
	| "assignee"
	| "status"
	| "acceptance"
	| "resolution-comment"
	| "discussion"
	| "protected-field";

export type ExternalChangeCandidate = {
	id: string;
	provider: TrackerProvider;
	issueId: string;
	ticketId?: string;
	sourceUser: string;
	sourceTime: string;
	kind: ExternalChangeKind;
	localValue: unknown;
	remoteValue: unknown;
	proposedOperation:
		| "claim-proposal"
		| "status-proposal"
		| "evidence-review-proposal"
		| "resolution-proposal"
		| "record-discussion"
		| "manual-resolution-required";
	risk: "low" | "medium" | "high";
	automatic: false;
};

export type ApprovedExternalChange = {
	candidateId: string;
	operation:
		| { kind: "block-ticket"; reason: string }
		| { kind: "resume-ticket" }
		| { kind: "cancel-ticket"; reason: string }
		| {
				kind: "claim-ticket";
				owner: string;
				leaseId: string;
				bindingKind: "analysis";
		  };
};

export type ProjectionPublishOptions = {
	completedSteps?: readonly string[];
	onlyStepId?: string;
};

export type NativeApproval = (input: {
	provider: TrackerProvider;
	repository: string;
	operationId: string;
	stepId: string;
	action: ProjectionPlan["steps"][number]["action"];
	artifact: ProjectionArtifact;
}) => Promise<void> | void;

export interface TrackerProjectionAdapter {
	readonly provider: TrackerProvider;
	inspectConfiguration(): Promise<TrackerConfigurationReadback>;
	previewProjection(map: WorkMapV1): Promise<ProjectionPlan>;
	publish(
		plan: ProjectionPlan,
		approval: NativeApproval,
		options?: ProjectionPublishOptions,
	): Promise<ProjectionResult>;
	inspectRemote(workId: string): Promise<RemoteProjectionState>;
	diff(
		map: WorkMapV1,
		remote: RemoteProjectionState,
	): ExternalChangeCandidate[];
}

type TrackerCommandResult = {
	status: number;
	stdout: string;
	stderr: string;
};

export type TrackerCommandRunner = (
	command: string,
	args: readonly string[],
) => TrackerCommandResult;
