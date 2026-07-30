import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmdirSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	renderWorkMapMarkdown,
	WorkMapStore,
	type WorkMapTransactionStep,
} from "../workflows/work-map-store";
import type { WorkMapCreateInput } from "../workflows/work-map";

const cleanup: string[] = [];

afterEach(() => {
	for (const path of cleanup.splice(0)) {
		rmSync(path, { recursive: true, force: true });
	}
});

describe("WorkMapStore", () => {
	test("create/read round trip writes event and active pointer", () => {
		const { repo, home } = fixture();
		const store = createStore(repo, home, "work-a");
		const created = store.create(input(), "codex");
		expect(store.read(created.id)).toEqual(created);
		expect(store.readActive()).toEqual(created);
		expect(store.events(created.id)).toEqual([
			expect.objectContaining({
				operation: "create",
				beforeRevision: null,
				afterRevision: 1,
				actor: "codex",
			}),
		]);
	});

	test("atomic update increments revision and rejects stale concurrency", () => {
		const { repo, home } = fixture();
		const store = createStore(repo, home, "work-a");
		const created = store.create(input(), "codex");
		const updated = store.update(
			created.id,
			1,
			"block",
			"codex",
			(map) => ({ ...map, status: "blocked" }),
		);
		expect(updated.revision).toBe(2);
		expect(updated.status).toBe("blocked");
		expect(() =>
			store.update(created.id, 1, "stale", "codex", (map) => map),
		).toThrow("stale Work Map revision");
		expect(store.read(created.id)).toEqual(updated);
	});

	test("generic update rejects ticket additions and removals", () => {
		const { repo, home } = fixture();
		const store = createStore(repo, home, "work-a");
		const created = store.create(input(), "codex");
		expect(() =>
			store.update(created.id, 1, "add-ticket", "codex", (map) => ({
				...map,
				tickets: [
					...map.tickets,
					{
						...map.tickets[0],
						id: "ticket-b",
						title: "Implement ticket-b",
					},
				],
			})),
		).toThrow("ticket set cannot change during update: added ticket-b");
		expect(() =>
			store.update(created.id, 1, "remove-ticket", "codex", (map) => ({
				...map,
				tickets: [],
			})),
		).toThrow("ticket set cannot change during update: removed ticket-a");
		expect(store.read(created.id)).toEqual(created);
	});

	test("invalid event metadata cannot commit a revision", () => {
		const { repo, home } = fixture();
		const store = createStore(repo, home, "work-a");
		const created = store.create(input(), "codex");
		const mapBefore = readFileSync(store.mapPath(created.id));
		const markdownBefore = readFileSync(store.markdownPath(created.id));
		const eventsBefore = readFileSync(store.eventsPath(created.id));

		expect(() =>
			store.update(created.id, 1, "", "codex", (map) => ({
				...map,
				status: "blocked",
			})),
		).toThrow("operation must be a non-empty string");
		expect(() =>
			store.update(created.id, 1, "block", "", (map) => ({
				...map,
				status: "blocked",
			})),
		).toThrow("actor must be a non-empty string");

		expect(readFileSync(store.mapPath(created.id))).toEqual(mapBefore);
		expect(readFileSync(store.markdownPath(created.id))).toEqual(markdownBefore);
		expect(readFileSync(store.eventsPath(created.id))).toEqual(eventsBefore);
		expect(store.read(created.id)).toEqual(created);
	});

	test("recovers a complete revision after every interrupted commit step", () => {
		for (const step of [
			"before-event",
			"after-event",
			"after-markdown",
			"after-map",
		] satisfies WorkMapTransactionStep[]) {
			const { repo, home } = fixture();
			const initial = createStore(repo, home, "work-a");
			const created = initial.create(input(), "codex");
			let injected = false;
			const interrupted = createStore(repo, home, "unused", (current) => {
				if (!injected && current === step) {
					injected = true;
					throw new Error(`injected interruption: ${step}`);
				}
			});
			expect(() =>
				interrupted.update(created.id, 1, "block", "codex", (map) => ({
					...map,
					status: "blocked",
				})),
			).toThrow(`injected interruption: ${step}`);

			const recovered = createStore(repo, home, "unused");
			const map = recovered.read(created.id);
			expect(map.revision).toBe(2);
			expect(map.status).toBe("blocked");
			expect(readFileSync(recovered.markdownPath(created.id), "utf8")).toBe(
				renderWorkMapMarkdown(map),
			);
			expect(recovered.events(created.id)).toEqual([
				expect.objectContaining({ operation: "create", afterRevision: 1 }),
				expect.objectContaining({
					operation: "block",
					beforeRevision: 1,
					afterRevision: 2,
				}),
			]);
		}
	});

	test("recovers a journal and stale lock after a process crash", async () => {
		const { repo, home } = fixture();
		const initial = createStore(repo, home, "work-a");
		initial.create(input(), "codex");
		const moduleUrl = pathToFileURL(
			join(
				dirname(fileURLToPath(import.meta.url)),
				"../workflows/work-map-store.ts",
			),
		).href;
		const worker = Bun.spawn({
			cmd: [
				process.execPath,
				"-e",
				`
					import { WorkMapStore } from ${JSON.stringify(moduleUrl)};
					const store = new WorkMapStore({
						cwd: ${JSON.stringify(repo)},
						goldbandHome: ${JSON.stringify(home)},
						transactionObserver: (step) => {
							if (step === "after-event") process.exit(91);
						},
					});
					store.update("work-a", 1, "block", "codex", (map) => ({
						...map,
						status: "blocked",
					}));
				`,
			],
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(await worker.exited).toBe(91);

		const recovered = createStore(repo, home, "unused");
		const map = recovered.read("work-a");
		expect(map.revision).toBe(2);
		expect(map.status).toBe("blocked");
		expect(recovered.events("work-a")).toHaveLength(2);
	});

	test("recovers ownerless legacy locks without blocking state access", () => {
		const { repo, home } = fixture();
		const store = createStore(repo, home, "work-a");
		const created = store.create(input(), "codex");
		mkdirSync(join(store.workRoot, created.id, ".update-lock"));
		expect(store.read(created.id)).toEqual(created);
		mkdirSync(join(store.workRoot, ".active-pointer-lock"));
		expect(() => store.setActive(created.id)).not.toThrow();
		expect(store.readActive()).toEqual(created);
	});

	test("rejects a symlink in the state path", () => {
		const { repo, home } = fixture();
		const target = mkdtempSync(join(tmpdir(), "goldband-work-target-"));
		cleanup.push(target);
		symlinkSync(target, join(home, "projects"));
		expect(() => createStore(repo, home, "work-a")).toThrow(
			"state path must be a real directory",
		);
	});

	test("isolates active maps by branch", () => {
		const { repo, home } = fixture();
		runGit(repo, ["checkout", "-b", "branch-a"]);
		const branchA = createStore(repo, home, "work-a");
		expect(branchA.create(input(), "codex").id).toBe("work-a");
		runGit(repo, ["checkout", "-b", "branch-b"]);
		const branchB = createStore(repo, home, "work-b");
		expect(branchB.readActive()).toBeNull();
		expect(() => branchB.read("work-a")).toThrow(
			"Work Map repository identity mismatch",
		);
		expect(branchB.create(input(), "codex").id).toBe("work-b");
		runGit(repo, ["checkout", "branch-a"]);
		expect(createStore(repo, home, "unused").readActive()?.id).toBe("work-a");
	});

	test("isolates active maps by worktree", () => {
		const { repo, home } = fixture();
		const worktree = mkdtempSync(join(tmpdir(), "goldband-worktree-parent-"));
		rmSync(worktree, { recursive: true, force: true });
		cleanup.push(worktree);
		runGit(repo, ["branch", "linked"]);
		runGit(repo, ["worktree", "add", worktree, "linked"]);
		const primary = createStore(repo, home, "work-primary");
		primary.create(input(), "codex");
		const linked = createStore(worktree, home, "work-linked");
		expect(linked.readActive()).toBeNull();
		linked.create(input(), "codex");
		expect(primary.readActive()?.id).toBe("work-primary");
		expect(linked.readActive()?.id).toBe("work-linked");
	});

	test("serializes active pointer updates across worktrees", async () => {
		const { repo, home } = fixture();
		const worktree = mkdtempSync(join(tmpdir(), "goldband-worktree-parent-"));
		rmSync(worktree, { recursive: true, force: true });
		cleanup.push(worktree);
		runGit(repo, ["branch", "linked"]);
		runGit(repo, ["worktree", "add", worktree, "linked"]);

		const primary = createStore(repo, home, "work-primary");
		primary.create(input(), "codex");
		const primaryPointer = readFileSync(primary.activePath, "utf8");
		const linked = createStore(worktree, home, "work-linked");
		linked.create(input(), "codex");

		const lock = join(primary.workRoot, ".active-pointer-lock");
		mkdirSync(lock, { mode: 0o700 });
		const lockOwner = join(lock, "owner.json");
		writeFileSync(
			lockOwner,
			JSON.stringify({
				schemaVersion: 1,
				pid: process.pid,
				token: "test-owner",
			}),
		);
		const coordination = mkdtempSync(join(tmpdir(), "goldband-active-pointer-"));
		cleanup.push(coordination);
		const ready = join(coordination, "ready");
		const start = join(coordination, "start");
		const calling = join(coordination, "calling");
		const moduleUrl = pathToFileURL(
			join(
				dirname(fileURLToPath(import.meta.url)),
				"../workflows/work-map-store.ts",
			),
		).href;
		const worker = Bun.spawn({
			cmd: [
				process.execPath,
				"-e",
				`
					import { existsSync, writeFileSync } from "node:fs";
					import { WorkMapStore } from ${JSON.stringify(moduleUrl)};
					const store = new WorkMapStore({
						cwd: ${JSON.stringify(worktree)},
						goldbandHome: ${JSON.stringify(home)},
					});
					writeFileSync(${JSON.stringify(ready)}, "");
					while (!existsSync(${JSON.stringify(start)})) await Bun.sleep(5);
					writeFileSync(${JSON.stringify(calling)}, "");
					store.setActive("work-linked");
				`,
			],
			stdout: "pipe",
			stderr: "pipe",
		});
		await waitForFile(ready);
		writeFileSync(start, "");
		await waitForFile(calling);
		writeFileSync(primary.activePath, primaryPointer);
		rmSync(lockOwner);
		rmdirSync(lock);

		const exitCode = await worker.exited;
		expect(exitCode).toBe(0);
		expect(primary.readActive()?.id).toBe("work-primary");
		expect(linked.readActive()?.id).toBe("work-linked");
	});

	test("Markdown projection deterministically matches authoritative JSON", () => {
		const { repo, home } = fixture();
		const store = createStore(repo, home, "work-a");
		const map = store.create(input(), "codex");
		expect(readFileSync(store.markdownPath(map.id), "utf8")).toBe(
			renderWorkMapMarkdown(map),
		);
		expect(JSON.parse(readFileSync(store.mapPath(map.id), "utf8"))).toEqual(map);
	});

	test("a failed update leaves the previous valid state", () => {
		const { repo, home } = fixture();
		const store = createStore(repo, home, "work-a");
		const created = store.create(input(), "codex");
		expect(() =>
			store.update(created.id, 1, "invalid", "codex", (map) => ({
				...map,
				destination: "",
			})),
		).toThrow("destination must be a non-empty string");
		expect(store.read(created.id)).toEqual(created);
		expect(existsSync(store.mapPath(created.id))).toBe(true);
	});

	test("rejects path traversal and repository identity mismatch", () => {
		const { repo, home } = fixture();
		const store = createStore(repo, home, "../escape");
		expect(() => store.create(input(), "codex")).toThrow("invalid Work Map id");

		const valid = createStore(repo, home, "work-a");
		const map = valid.create(input(), "codex");
		const raw = JSON.parse(readFileSync(valid.mapPath(map.id), "utf8"));
		raw.repository.identity = "other";
		writeFileSync(valid.mapPath(map.id), JSON.stringify(raw));
		expect(() => valid.read(map.id)).toThrow(
			"Work Map repository identity mismatch",
		);
	});

	test("rejects a map whose payload identity differs from its state path", () => {
		const { repo, home } = fixture();
		const store = createStore(repo, home, "work-a");
		const map = store.create(input(), "codex");
		const raw = JSON.parse(readFileSync(store.mapPath(map.id), "utf8"));
		raw.id = "work-b";
		writeFileSync(store.mapPath(map.id), JSON.stringify(raw));
		expect(() => store.read("work-a")).toThrow(
			"Work Map path identity mismatch: expected work-a, found work-b",
		);
		expect(() => store.readActive()).toThrow(
			"Work Map path identity mismatch: expected work-a, found work-b",
		);
	});

	test("rejects schema-valid map changes without matching transition evidence", () => {
		const { repo, home } = fixture();
		const store = createStore(repo, home, "work-a");
		const map = store.create(input(), "codex");
		const raw = JSON.parse(readFileSync(store.mapPath(map.id), "utf8"));
		raw.status = "blocked";
		writeFileSync(store.mapPath(map.id), JSON.stringify(raw));
		expect(() => store.read(map.id)).toThrow(
			"Work Map history integrity mismatch: work-a",
		);
		expect(() => store.readActive()).toThrow(
			"Work Map history integrity mismatch: work-a",
		);
	});
});

function fixture(): { repo: string; home: string } {
	const repo = mkdtempSync(join(tmpdir(), "goldband-work-map-repo-"));
	const home = mkdtempSync(join(tmpdir(), "goldband-work-map-home-"));
	cleanup.push(repo, home);
	runGit(repo, ["init"]);
	runGit(repo, ["config", "user.email", "test@example.com"]);
	runGit(repo, ["config", "user.name", "Test"]);
	writeFileSync(join(repo, "README.md"), "fixture\n");
	runGit(repo, ["add", "README.md"]);
	runGit(repo, ["commit", "-m", "initial"]);
	return { repo, home };
}

function createStore(
	repo: string,
	home: string,
	id: string,
	transactionObserver?: (step: WorkMapTransactionStep) => void,
): WorkMapStore {
	return new WorkMapStore({
		cwd: repo,
		goldbandHome: home,
		clock: () => new Date("2026-07-30T00:00:00.000Z"),
		idFactory: () => id,
		transactionObserver,
	});
}

function input(): WorkMapCreateInput {
	return {
		mode: "bounded",
		destination: "Create a durable Work Map",
		scope: {
			included: ["Local state"],
			excluded: ["External trackers"],
		},
		decisions: [],
		fog: [],
		tickets: [
			{
				id: "ticket-a",
				title: "Implement store",
				delivers: "Durable local Work Map state",
				blockedBy: [],
				acceptanceCriteria: ["State survives a process restart"],
				verificationMode: "existing-tests",
				testSeams: ["store test"],
				status: "ready",
			},
		],
	};
}

function runGit(cwd: string, args: string[]): void {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(result.stderr || result.stdout);
	}
}

async function waitForFile(path: string): Promise<void> {
	const deadline = Date.now() + 5_000;
	while (!existsSync(path)) {
		if (Date.now() >= deadline) throw new Error(`timed out waiting for ${path}`);
		await Bun.sleep(5);
	}
}
