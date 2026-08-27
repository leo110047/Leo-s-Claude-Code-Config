import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evidenceChildProcessEnvironment } from "../lib/evidence-runtime-contract.ts";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("review receipt authority provisioning", () => {
	test("provisions Claude-compatible authority and preserves its key across reinstall", () => {
		const root = mkdtempSync(join(tmpdir(), "review-receipt-authority-"));
		roots.push(root);
		const runtimeRoot = join(root, "claude", "skills", "goldband");
		const authorityRoot = join(root, "state", "review-authority", "claude");
		const script = join(import.meta.dir, "..", "scripts", "provision-review-receipt-authority.ts");
		const run = () => spawnSync(process.execPath, [
			script,
			"--runtime-root", runtimeRoot,
			"--authority-root", authorityRoot,
		], { encoding: "utf8" });
		const first = run();
		expect(first.status).toBe(0);
		const keyFile = join(authorityRoot, "review-receipt.key");
		const firstKey = readFileSync(keyFile, "utf8");
		expect(firstKey).toMatch(/^[a-f0-9]{64}\n$/);
		expect(statSync(keyFile).mode & 0o077).toBe(0);

		const second = run();
		expect(second.status).toBe(0);
		expect(readFileSync(keyFile, "utf8")).toBe(firstKey);
		const config = JSON.parse(readFileSync(join(runtimeRoot, "trusted-runtime.json"), "utf8"));
		expect(config).toMatchObject({
			schemaVersion: 2,
			reviewReceiptAuthorityRoot: authorityRoot,
			reviewReceiptKeyFile: keyFile,
			reviewReceiptStore: join(authorityRoot, "review-receipts"),
		});
	});

	test("Claude-installed launcher forwards its authority to the source runtime", () => {
		const root = mkdtempSync(join(tmpdir(), "review-receipt-claude-launcher-"));
		roots.push(root);
		const sourceRoot = join(import.meta.dir, "..");
		const runtimeRoot = join(root, "claude", "skills", "goldband");
		const authorityRoot = join(root, "state", "review-authority", "claude");
		const provision = spawnSync(process.execPath, [
			join(sourceRoot, "scripts", "provision-review-receipt-authority.ts"),
			"--runtime-root", runtimeRoot,
			"--authority-root", authorityRoot,
		], { encoding: "utf8" });
		expect(provision.status, provision.stderr).toBe(0);
		cpSync(join(sourceRoot, "bin"), join(runtimeRoot, "bin"), { recursive: true });
		symlinkSync(join(sourceRoot, "lib"), join(runtimeRoot, "lib"), "dir");
		writeFileSync(join(runtimeRoot, ".installed-source"), `${sourceRoot}\n`);

		const repo = join(root, "repo");
		const stateRoot = join(root, "workflow-state");
		mkdirSync(repo);
		expect(spawnSync("git", ["init"], { cwd: repo }).status).toBe(0);
		writeFileSync(join(repo, "goldband.review-evidence.json"), `${JSON.stringify({
			schemaVersion: 1,
			behaviorMatrix: [{
				id: "unsupported-runtime",
				behavior: "The unavailable integration is disclosed.",
				kind: "boundary",
				input: "candidate",
				preconditions: "external runner",
				expected: "live readback exists",
				risk: "high",
				disposition: "unsupported",
				providerIds: [],
				reason: "No authorized external runner exists in this fixture.",
			}],
			providers: [],
			authorizations: [],
		})}\n`);
		const reviewArgs = [
			join(runtimeRoot, "bin", "goldband.ts"),
			"review", "code", "--host", "claude",
		];
		const reviewOptions = {
			cwd: repo,
			encoding: "utf8" as const,
			env: {
				...process.env,
				...evidenceChildProcessEnvironment(process.env),
				GOLDBAND_HOME: stateRoot,
			},
		};
		const review = spawnSync(process.execPath, reviewArgs, reviewOptions);
		expect(review.status, review.stderr).toBe(0);
		expect(review.stdout).toContain("Semantic host calls: 0.");
		const result = JSON.parse(review.stdout) as { artifacts: string[] };
		const artifactPath = result.artifacts.find((file) =>
			file.endsWith("-review-evidence.json"));
		expect(artifactPath).toBeDefined();
		const artifact = JSON.parse(readFileSync(artifactPath!, "utf8"));
		expect(artifact.runtimeReceipt.signature).toMatch(/^[a-f0-9]{64}$/);
		expect(readFileSync(
			join(authorityRoot, "review-receipts", `${artifact.runtimeReceipt.id}.json`),
			"utf8",
		)).toContain(`"runId": "${artifact.runId}"`);
	}, 30_000);
});
