import { parseWorkMap, type WorkMapV1 } from "../workflows/work-map";

export function sampleWorkMap(overrides: Partial<WorkMapV1> = {}): WorkMapV1 {
	return parseWorkMap({
		schemaVersion: 1,
		id: "work-1",
		revision: 3,
		createdAt: "2026-08-01T00:00:00.000Z",
		updatedAt: "2026-08-02T00:00:00.000Z",
		repository: { identity: "/tmp/repo/.git", cwd: "/tmp/repo", branch: "dev", baseCommit: "a".repeat(40) },
		mode: "wayfinding",
		status: "executing",
		destination: "Ship collaboration adapters",
		scope: { included: ["GitHub and GitLab"], excluded: ["Jira"] },
		decisions: [{ id: "decision-1", summary: "Local state remains authoritative" }],
		fog: [{ id: "fog-1", question: "Live provider behavior", blockedBy: [], status: "unresolved", graduatedTicketIds: [] }],
		tickets: [
			{
				id: "ticket-1", title: "Projection", delivers: "A deterministic projection", blockedBy: [],
				acceptanceCriteria: ["Markers round trip"], verificationMode: "existing-tests",
				verificationCommand: ["bun", "test"], testSeams: ["projection"], status: "ready",
			},
			{
				id: "ticket-2", title: "Runtime", delivers: "A resumable runtime", blockedBy: ["ticket-1"],
				acceptanceCriteria: ["Retries do not duplicate"], verificationMode: "existing-tests",
				verificationCommand: ["bun", "test"], testSeams: ["runtime"], status: "ready",
			},
		],
		frontier: ["ticket-1"], blockers: [],
		...overrides,
	});
}
