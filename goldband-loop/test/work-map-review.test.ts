import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createManagedWorktree } from "../lib/managed-worktree";
import {
	readAndValidateAnalysisArtifact,
	recordAnalysisArtifact,
	recordVerification,
} from "../lib/verification-receipt";
import { getWorkflow } from "../workflows/registry";
import { runWorkflow } from "../workflows/runtime";
import { WorkMapStore } from "../workflows/work-map-store";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Work Map review readback", () => {
	test("requested changes return an implemented ticket to claimed", () => {
		const { store } = fixture();
		const created = store.create(input(), "codex");
		const claimed = store.claimTicket({
			workId: created.id,
			ticketId: "ticket-a",
			expectedRevision: created.revision,
			owner: "codex",
			leaseId: "lease-a",
		});
		const implemented = store.markImplemented({
			workId: created.id,
			ticketId: "ticket-a",
			expectedRevision: claimed.revision,
			actor: "recorder",
			receipt: {
				id: "receipt-a",
				digest: "a".repeat(64),
				treeDigest: "b".repeat(64),
			},
		});
		const changed = store.requestChanges({
			workId: created.id,
			ticketId: "ticket-a",
			expectedRevision: implemented.revision,
			actor: "review-readback",
			review: {
				id: "review-a",
				digest: "c".repeat(64),
				treeDigest: "b".repeat(64),
			},
		});
		expect(changed.tickets[0]?.status).toBe("claimed");
		expect(changed.tickets[0]?.evidence?.receipt).toBeUndefined();
		expect(changed.tickets[0]?.evidence?.requestedChanges?.id).toBe("review-a");
		expect(changed.tickets[0]?.claim?.attempt).toBe(2);
	});

	test("analysis-only artifact follows implemented, reviewed, and completed lifecycle", async () => {
		const { store, repo, state } = fixture();
		store.create(analysisInput(), "codex");
		fs.mkdirSync(path.join(repo, "reports"));
		fs.writeFileSync(path.join(repo, "reports", "ticket-a.md"), "# Result\n\nEvidence.\n");
		recordAnalysisArtifact({
			cwd: repo,
			env: { ...process.env, GOLDBAND_HOME: state },
			workId: "work-a",
			ticketId: "ticket-a",
			artifactPath: "reports/ticket-a.md",
		});
		const originalVerifyTicket = WorkMapStore.prototype.verifyTicket;
		let injectedRevisionRace = false;
		WorkMapStore.prototype.verifyTicket = function (request) {
			if (!injectedRevisionRace) {
				const current = this.read(request.workId);
				this.update(
					request.workId,
					current.revision,
					"concurrent-map-note",
					"other-actor",
					(map) => {
						map.destination = "Complete a reviewed analysis artifact safely";
						return map;
					},
				);
				injectedRevisionRace = true;
			}
			return originalVerifyTicket.call(this, request);
		};
		try {
			await runWorkflow(getWorkflow("review/code"), {
				mode: "mock",
				host: "mock",
				workId: "work-a",
				ticketId: "ticket-a",
				cwd: repo,
				goldbandHome: state,
			});
		} finally {
			WorkMapStore.prototype.verifyTicket = originalVerifyTicket;
		}
		expect(injectedRevisionRace).toBe(true);
		const completed = store.read("work-a");
		expect(completed.tickets[0]?.status).toBe("verified");
		expect(completed.tickets[0]?.evidence?.review?.artifactDigest).toBeDefined();
		expect(completed.status).toBe("completed");
	});

	test("review rejects an analysis artifact changed after the model pass", async () => {
		const { store, repo, state } = fixture();
		store.create(analysisInput(), "codex");
		fs.mkdirSync(path.join(repo, "reports"));
		fs.writeFileSync(path.join(repo, "reports", "ticket-a.md"), "# Result\n\nEvidence.\n");
		recordAnalysisArtifact({
			cwd: repo,
			env: { ...process.env, GOLDBAND_HOME: state },
			workId: "work-a",
			ticketId: "ticket-a",
			artifactPath: "reports/ticket-a.md",
		});
		const implemented = store.read("work-a");
		const analysis = readAndValidateAnalysisArtifact({
			store,
			map: implemented,
			ticket: implemented.tickets[0]!,
		});
		const restore = mutateOnThirdRead(() => {
			fs.writeFileSync(analysis.artifact.contentPath, "changed after review\n");
		});
		try {
			await expect(
				runWorkflow(getWorkflow("review/code"), {
					mode: "mock",
					host: "mock",
					workId: "work-a",
					ticketId: "ticket-a",
					cwd: repo,
					goldbandHome: state,
				}),
			).rejects.toThrow("analysis artifact content digest is stale");
		} finally {
			restore();
		}
		expect(store.read("work-a").tickets[0]?.status).toBe("implemented");
	});

	test("review rejects a code candidate changed after the model pass", async () => {
		const { store, repo, state } = fixture();
		store.create(input(), "codex");
		const lease = createManagedWorktree({
			name: "review-race",
			repoRoot: repo,
			stateRoot: state,
			ticketId: "ticket-a",
		});
		fs.writeFileSync(path.join(lease.worktreePath, "candidate.txt"), "reviewed\n");
		recordVerification({
			stage: "check",
			command: input().tickets[0]!.verificationCommand,
			cwd: lease.worktreePath,
		});
		const restore = mutateOnThirdRead(() => {
			fs.writeFileSync(path.join(lease.worktreePath, "candidate.txt"), "changed\n");
		});
		try {
			await expect(
				runWorkflow(getWorkflow("review/code"), {
					mode: "mock",
					host: "mock",
					workId: "work-a",
					ticketId: "ticket-a",
					cwd: lease.worktreePath,
					goldbandHome: state,
				}),
			).rejects.toThrow("verification receipt is stale for the current candidate");
		} finally {
			restore();
		}
		expect(store.read("work-a").tickets[0]?.status).toBe("implemented");
	});
});

function mutateOnThirdRead(mutate: () => void): () => void {
	const original = WorkMapStore.prototype.read;
	let reads = 0;
	WorkMapStore.prototype.read = function (workId) {
		const map = original.call(this, workId);
		reads += 1;
		if (reads === 3) mutate();
		return map;
	};
	return () => {
		WorkMapStore.prototype.read = original;
	};
}

function fixture(): { store: WorkMapStore; repo: string; state: string } {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "work-map-review-"));
	roots.push(root);
	const repo = path.join(root, "repo");
	fs.mkdirSync(repo);
	git(repo, ["init", "-b", "main"]);
	git(repo, ["config", "user.name", "Goldband Test"]);
	git(repo, ["config", "user.email", "goldband@example.invalid"]);
	fs.writeFileSync(path.join(repo, "file.txt"), "base\n");
	git(repo, ["add", "file.txt"]);
	git(repo, ["commit", "-m", "initial"]);
	const state = path.join(root, "state");
	const store = new WorkMapStore({
		cwd: repo,
		goldbandHome: state,
		idFactory: () => "work-a",
	});
	return { store, repo, state };
}

function input() {
	return {
		mode: "bounded" as const,
		destination: "Read back review evidence",
		scope: { included: ["ticket-a"], excluded: ["tracker"] },
		decisions: [],
		fog: [],
		tickets: [
			{
				id: "ticket-a",
				title: "Review ticket",
				delivers: "Review readback",
				blockedBy: [],
				acceptanceCriteria: ["Review is bound"],
				verificationMode: "existing-tests" as const,
				verificationCommand: [process.execPath, "-e", "process.exit(0)"],
				testSeams: ["unit"],
				status: "ready" as const,
			},
		],
	};
}

function analysisInput() {
	return {
		...input(),
		destination: "Complete a reviewed analysis artifact",
		tickets: [
			{
				...input().tickets[0],
				verificationMode: "analysis-only" as const,
				verificationCommand: undefined,
				analysisArtifact: "reports/ticket-a.md",
				testSeams: [],
			},
		],
	};
}

function git(cwd: string, args: string[]): void {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" });
	if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}
