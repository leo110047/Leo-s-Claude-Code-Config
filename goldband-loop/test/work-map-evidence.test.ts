import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { WorkMapStore } from "../workflows/work-map-store";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Work Map evidence binding", () => {
	test("rejects review evidence from a different candidate tree", () => {
		const store = fixture();
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
		expect(() =>
			store.verifyTicket({
				workId: created.id,
				ticketId: "ticket-a",
				expectedRevision: implemented.revision,
				actor: "review",
				review: {
					id: "review-a",
					digest: "c".repeat(64),
					treeDigest: "d".repeat(64),
				},
			}),
		).toThrow("tree digests differ");
		expect(store.read(created.id).tickets[0]?.status).toBe("implemented");
	});
});

function fixture(): WorkMapStore {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "work-map-evidence-"));
	roots.push(root);
	const repo = path.join(root, "repo");
	fs.mkdirSync(repo);
	git(repo, ["init", "-b", "main"]);
	git(repo, ["config", "user.name", "Goldband Test"]);
	git(repo, ["config", "user.email", "goldband@example.invalid"]);
	fs.writeFileSync(path.join(repo, "file.txt"), "base\n");
	git(repo, ["add", "file.txt"]);
	git(repo, ["commit", "-m", "initial"]);
	return new WorkMapStore({
		cwd: repo,
		goldbandHome: path.join(root, "state"),
		idFactory: () => "work-a",
	});
}

function input() {
	return {
		mode: "bounded" as const,
		destination: "Bind implementation evidence",
		scope: { included: ["ticket-a"], excluded: ["tracker"] },
		decisions: [],
		fog: [],
		tickets: [
			{
				id: "ticket-a",
				title: "Implement ticket",
				delivers: "Bound evidence",
				blockedBy: [],
				acceptanceCriteria: ["Evidence matches"],
				verificationMode: "existing-tests" as const,
				verificationCommand: [process.execPath, "-e", "process.exit(0)"],
				testSeams: ["unit"],
				status: "ready" as const,
			},
		],
	};
}

function git(cwd: string, args: string[]): void {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" });
	if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}
