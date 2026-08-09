import type { WorkMapV1 } from "../work-map";
import {
	MAX_TRACKER_BODY_BYTES,
	parseProjectionMarker,
	projectionDigest,
	projectionProtectedFieldsMatchRemote,
	renderMapProjection,
	renderTicketProjection,
} from "./projection";
import type {
	ExternalChangeCandidate,
	RemoteIssue,
	RemoteProjectionState,
} from "./types";

const MAX_COMMENT_BYTES = 64 * 1024;
const RESOLUTION_PATTERN =
	/^goldband-resolution:\s*(block|resume|cancel)(?:\s+(.+))?$/i;

export function externalChangeCandidates(
	map: WorkMapV1,
	remote: RemoteProjectionState,
): ExternalChangeCandidate[] {
	if (remote.workId !== map.id)
		throw new Error("remote projection belongs to another Work Map");
	const candidates: ExternalChangeCandidate[] = [];
	if (remote.mapIssue) {
		assertBoundedIssue(remote.mapIssue);
		const marker = parseProjectionMarker(remote.mapIssue.body);
		if (marker.kind !== "map" || marker.workId !== map.id)
			throw new Error("forged Work Map marker");
		const artifact = renderMapProjection(map);
		if (
			marker.revision !== map.revision ||
			marker.digest !== artifact.digest ||
			!projectionProtectedFieldsMatchRemote(artifact, remote.mapIssue, remote)
		) {
			candidates.push(
				candidate(
					remote,
					remote.mapIssue,
					undefined,
					"protected-field",
					artifact.digest,
					protectedFieldDigest(remote.mapIssue),
					"manual-resolution-required",
					"high",
				),
			);
		}
	}
	for (const ticket of map.tickets) {
		const issue = remote.ticketIssues[ticket.id];
		if (!issue) {
			candidates.push(
				candidate(
					remote,
					missingIssue(ticket.id),
					ticket.id,
					"protected-field",
					"present",
					"deleted",
					"manual-resolution-required",
					"high",
				),
			);
			continue;
		}
		assertBoundedIssue(issue);
		const marker = parseProjectionMarker(issue.body);
		if (
			marker.kind !== "ticket" ||
			marker.workId !== map.id ||
			marker.ticketId !== ticket.id
		)
			throw new Error(`forged ticket marker: ${ticket.id}`);
		const artifact = renderTicketProjection(map, ticket);
		if (
			marker.revision !== map.revision ||
			marker.digest !== artifact.digest ||
			!projectionProtectedFieldsMatchRemote(artifact, issue, remote)
		) {
			candidates.push(
				candidate(
					remote,
					issue,
					ticket.id,
					"protected-field",
					artifact.digest,
					protectedFieldDigest(issue),
					"manual-resolution-required",
					"high",
				),
			);
		}
		const expectedAssignees = ticket.claim ? [ticket.claim.owner] : [];
		if (!sameStrings(expectedAssignees, issue.assignees)) {
			candidates.push(
				candidate(
					remote,
					issue,
					ticket.id,
					"assignee",
					expectedAssignees,
					issue.assignees,
					"claim-proposal",
					"high",
				),
			);
		}
		const expectedState =
			ticket.status === "verified" || ticket.status === "cancelled"
				? "closed"
				: "open";
		if (expectedState !== issue.state) {
			candidates.push(
				candidate(
					remote,
					issue,
					ticket.id,
					"status",
					expectedState,
					issue.state,
					"status-proposal",
					"high",
				),
			);
		}
		const checked = countCheckedAcceptance(issue.body);
		if (checked > 0) {
			candidates.push(
				candidate(
					remote,
					issue,
					ticket.id,
					"acceptance",
					0,
					checked,
					"evidence-review-proposal",
					"high",
				),
			);
		}
		for (const comment of issue.comments) {
			if (Buffer.byteLength(comment.body) > MAX_COMMENT_BYTES)
				throw new Error(`tracker comment exceeds size limit: ${comment.id}`);
			const resolution = RESOLUTION_PATTERN.exec(comment.body.trim());
			candidates.push({
				id: projectionDigest({
					provider: remote.provider,
					issue: issue.id,
					comment: comment.id,
				}),
				provider: remote.provider,
				issueId: issue.id,
				ticketId: ticket.id,
				sourceUser: cleanData(comment.author),
				sourceTime: validTimestamp(comment.createdAt),
				kind: resolution ? "resolution-comment" : "discussion",
				localValue: null,
				remoteValue: cleanData(comment.body),
				proposedOperation: resolution
					? "resolution-proposal"
					: "record-discussion",
				risk: resolution ? "high" : "low",
				automatic: false,
			});
		}
	}
	return candidates.sort((left, right) => left.id.localeCompare(right.id));
}

function protectedFieldDigest(issue: RemoteIssue): string {
	return projectionDigest({
		title: issue.title,
		body: issue.body,
		labels: [...issue.labels].sort(),
	});
}

function candidate(
	remote: RemoteProjectionState,
	issue: RemoteIssue,
	ticketId: string | undefined,
	kind: ExternalChangeCandidate["kind"],
	localValue: unknown,
	remoteValue: unknown,
	proposedOperation: ExternalChangeCandidate["proposedOperation"],
	risk: ExternalChangeCandidate["risk"],
): ExternalChangeCandidate {
	return {
		id: projectionDigest({
			provider: remote.provider,
			issue: issue.id,
			ticketId,
			kind,
			localValue,
			remoteValue,
		}),
		provider: remote.provider,
		issueId: issue.id,
		...(ticketId ? { ticketId } : {}),
		sourceUser: "tracker-readback",
		sourceTime: new Date(0).toISOString(),
		kind,
		localValue,
		remoteValue,
		proposedOperation,
		risk,
		automatic: false,
	};
}

function assertBoundedIssue(issue: RemoteIssue): void {
	if (Buffer.byteLength(issue.body) > MAX_TRACKER_BODY_BYTES)
		throw new Error(`tracker body exceeds size limit: ${issue.id}`);
}

function countCheckedAcceptance(body: string): number {
	const section =
		body.split("## Acceptance criteria", 2)[1]?.split(/^## /m, 1)[0] ?? "";
	return [...section.matchAll(/^- \[[xX]\] /gm)].length;
}

function sameStrings(left: string[], right: string[]): boolean {
	return [...left].sort().join("\0") === [...right].sort().join("\0");
}

function cleanData(value: string): string {
	return value
		.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
		.slice(0, MAX_COMMENT_BYTES);
}

function validTimestamp(value: string): string {
	if (Number.isNaN(Date.parse(value)))
		throw new Error("invalid tracker comment timestamp");
	return value;
}

function missingIssue(ticketId: string): RemoteIssue {
	return {
		id: `missing:${ticketId}`,
		url: "",
		title: "",
		body: "",
		state: "closed",
		labels: [],
		assignees: [],
		comments: [],
	};
}
