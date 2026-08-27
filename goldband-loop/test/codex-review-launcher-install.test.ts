import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { evidenceChildProcessEnvironment } from "../lib/evidence-runtime-contract.ts";
import {
	installCodexReviewLauncher,
	renderCodexReviewRule,
} from "../scripts/install-codex-review-launcher.ts";

const sourceRoot = resolve(import.meta.dir, "..");
const bunPath = process.execPath;

function spawnInstalledRuntime(
	command: string,
	args: string[],
	options: { cwd: string; encoding: "utf8"; env: NodeJS.ProcessEnv },
) {
	return spawnSync(command, args, {
		...options,
		env: {
			...evidenceChildProcessEnvironment(process.env),
			...options.env,
		},
	});
}

describe("Codex trusted workflow launcher install", () => {
	test("materializes review and browser owners with exact allow rules outside source", () => {
		const fixture = mkdtempSync(join(tmpdir(), "goldband-codex-review-install-"));
		const nestedEvidenceSandbox = process.env.GOLDBAND_EVIDENCE_SANDBOX_ACTIVE === "1";
		try {
			const trustedBin = join(fixture, "trusted-bin");
			const poisonBin = join(fixture, "poison-bin");
			const emptyHome = join(fixture, "empty-home");
			mkdirSync(trustedBin, { recursive: true });
			mkdirSync(poisonBin, { recursive: true });
			mkdirSync(emptyHome, { recursive: true });
			const fakeCodex = join(trustedBin, "codex");
			const fakeBrowser = join(trustedBin, "browse");
			writeFileSync(
				fakeCodex,
				[
					"#!/usr/bin/env bash",
					"set -euo pipefail",
					'output=""',
					'while [ "$#" -gt 0 ]; do',
					'  if [ "$1" = "-o" ]; then output="$2"; shift 2; continue; fi',
					"  shift",
					"done",
					'test -n "$output"',
					'prompt="$(cat)"',
					'if printf \'%s\' "$prompt" | grep -q CLOSURE_INPUT_START; then',
					'  printf \'%s\\n\' \'{"results":[{"findingId":"S-001","status":"closed","summary":"repair verified","evidenceIds":["installed-gate:pass"]}]}\' > "$output"',
					'elif [ "${GOLDBAND_EVIDENCE_SANDBOX_ACTIVE:-}" = "1" ]; then',
					'  printf \'%s\\n\' \'{"findings":[{"id":"F-001","file":"review-me.txt","line":1,"severity":"medium","summary":"fixture finding","evidence":"fixture semantic observation","failureScenario":"fixture path","suggestedVerification":"inspect installed phases","classification":"semantic-concern","blocking":false,"evidenceIds":["cell:installed-review:unsupported"],"behaviorCellIds":["installed-review"]}]}\' > "$output"',
					'else',
					'  printf \'%s\\n\' \'{"findings":[{"id":"F-001","file":"review-me.txt","line":1,"severity":"medium","summary":"fixture finding","evidence":"fixture semantic observation","failureScenario":"fixture path","suggestedVerification":"rerun installed gate","classification":"semantic-concern","blocking":false,"evidenceIds":["installed-gate:pass"],"behaviorCellIds":["installed-review"]}]}\' > "$output"',
					'fi',
				].join("\n"),
			);
			chmodSync(fakeCodex, 0o755);
			writeFileSync(
				fakeBrowser,
				"#!/usr/bin/env bash\nset -euo pipefail\nprintf 'browser-ok:%s\\n' \"$*\"\n",
			);
			chmodSync(fakeBrowser, 0o755);
			const poisonCodex = join(poisonBin, "codex");
			writeFileSync(poisonCodex, "#!/usr/bin/env bash\nexit 99\n");
			chmodSync(poisonCodex, 0o755);
			const runtimeRoot = join(fixture, "codex", "goldband", "workflow-runtime");
			const ruleFile = join(fixture, "codex", "rules", "goldband-workflows.rules");
			const markerFile = join(fixture, "codex", "skills", "goldband", ".workflow-launcher.json");
			const marker = installCodexReviewLauncher({
				sourceRoot,
				runtimeRoot,
				ruleFile,
				markerFile,
				bunPath,
				codexPath: fakeCodex,
				browserPath: fakeBrowser,
				bundleBrowserServer: (_bun, _entry, outputDirectory) => {
					mkdirSync(outputDirectory, { recursive: true });
					writeFileSync(join(outputDirectory, "server.js"), "// fixture\n");
				},
			});
			const receiptKeyFile = join(dirname(runtimeRoot), "review-receipt.key");
			expect(readFileSync(receiptKeyFile, "utf8").trim()).toMatch(/^[a-f0-9]{64}$/);

			expect(marker.argvPrefix).toEqual([
				bunPath,
				join(runtimeRoot, "bin", "goldband.js"),
			]);
			expect(existsSync(join(runtimeRoot, "workflows", "run.ts"))).toBe(true);
			expect(existsSync(join(runtimeRoot, "browse", "browse"))).toBe(true);
			expect(existsSync(join(runtimeRoot, "browse", "server", "server.js"))).toBe(true);
			expect(existsSync(join(runtimeRoot, "review", "shared-rubric.md"))).toBe(true);
			expect(existsSync(join(runtimeRoot, "review", "rules-resolver.js"))).toBe(true);
			expect(existsSync(join(runtimeRoot, "review", "rules", "manifest.json"))).toBe(true);
			const trustedConfig = JSON.parse(
				readFileSync(join(runtimeRoot, "trusted-runtime.json"), "utf8"),
			);
			expect(trustedConfig.schemaVersion).toBe(2);
			expect(trustedConfig.rulesResolverScript).toBe(
				join(runtimeRoot, "review", "rules-resolver.js"),
			);
			expect(trustedConfig.rulesDirectory).toBe(
				join(runtimeRoot, "review", "rules"),
			);
			expect(readFileSync(markerFile, "utf8")).toContain('"schemaVersion": 1');
			const rule = readFileSync(ruleFile, "utf8");
			expect(rule).toBe(renderCodexReviewRule(marker));
			expect(rule).toContain('"review", "code", "--host", "codex"');
			expect(rule).toContain('"browser", "session", "--host", "codex"');
			expect(rule).not.toContain(sourceRoot);

			const help = spawnSync(marker.argvPrefix[0], [marker.argvPrefix[1], "--help"], {
				encoding: "utf8",
			});
			expect(help.status).toBe(0);
			expect(help.stdout).toContain("goldband review code");

			const repo = join(fixture, "repo");
			const stateRoot = join(fixture, "state");
			const poisonRoot = join(fixture, "poison-runtime");
			mkdirSync(repo, { recursive: true });
			mkdirSync(join(poisonRoot, "workflows"), { recursive: true });
			writeFileSync(
				join(poisonRoot, "workflows", "run.ts"),
				"console.error('poison workflow executed'); process.exit(99);\n",
			);
			const initializeRepository = spawnSync("git", ["init"], {
				cwd: repo,
				encoding: "utf8",
			});
			expect(initializeRepository.status, initializeRepository.stderr).toBe(0);
			writeFileSync(join(repo, "review-me.txt"), "baseline\n");
			expect(spawnSync("git", ["add", "review-me.txt"], { cwd: repo }).status).toBe(0);
			const initialCommit = spawnSync(
				"git",
				[
					"-c",
					"user.name=Goldband Test",
					"-c",
					"user.email=goldband@example.invalid",
					"commit",
					"-m",
					"fixture baseline",
				],
				{ cwd: repo, encoding: "utf8" },
			);
			expect(initialCommit.status, initialCommit.stderr).toBe(0);
			writeFileSync(join(repo, "review-me.txt"), "change\n");
			writeFileSync(
				join(repo, "goldband.review-evidence.json"),
				`${JSON.stringify(installedReviewEvidenceManifest(nestedEvidenceSandbox))}\n`,
			);
			const review = spawnInstalledRuntime(
				marker.argvPrefix[0],
				[
					marker.argvPrefix[1],
					"review",
					"code",
					"--host",
					"codex",
				],
				{
					cwd: repo,
					encoding: "utf8",
					env: {
						...process.env,
						HOME: emptyHome,
						GOLDBAND_HOME: stateRoot,
						GOLDBAND_ROOT: poisonRoot,
						GOLDBAND_RULES_DIR: join(poisonRoot, "rules"),
						PATH: `${poisonBin}:${process.env.PATH ?? ""}`,
					},
				},
			);
			expect(
				review.status,
				[
					`review stdout:\n${review.stdout}`,
					`review stderr:\n${review.stderr}`,
				].join("\n"),
			).toBe(0);
			expect(review.stdout).toContain("review/code runtime report");
			expect(review.stdout).toContain("Phase: initial.");
			expect(review.stdout).toContain(nestedEvidenceSandbox
				? "Deterministic evidence: 0 verified pass, 0 verified failure, 1 coverage gap"
				: "Deterministic evidence: 1 verified pass");
			const reviewResult = JSON.parse(review.stdout) as { artifacts: string[] };
			const initialArtifactPath = reviewResult.artifacts.find((file) =>
				file.endsWith("-review-evidence.json"));
			expect(initialArtifactPath).toBeDefined();
			const initialArtifact = JSON.parse(readFileSync(initialArtifactPath!, "utf8"));
			const runtimeReceiptId = initialArtifact.runtimeReceipt.id;
			expect(runtimeReceiptId).toMatch(/^[A-Za-z0-9._-]+$/);
			expect(initialArtifact).toMatchObject({
				phase: "initial",
				hostCallCount: nestedEvidenceSandbox ? 0 : 1,
				runtimeReceipt: {
					schemaVersion: 1,
					id: expect.any(String),
					digest: expect.stringMatching(/^[a-f0-9]{64}$/),
					signature: expect.stringMatching(/^[a-f0-9]{64}$/),
					reviewScope: { kind: "standalone" },
				},
				evidence: nestedEvidenceSandbox ? {
					records: [{ id: "cell:installed-review:unsupported", status: "coverage-gap", fresh: true }],
				} : {
					records: [{ id: "installed-gate:pass", status: "verified-pass", fresh: true }],
				},
			});
			expect(readFileSync(
				join(
					dirname(runtimeRoot),
					"review-receipts",
					`${runtimeReceiptId}.json`,
				),
				"utf8",
			)).toContain(initialArtifact.binding.candidateDigest);
			if (nestedEvidenceSandbox) return;

			const forgedArtifactPath = join(repo, "forged-initial-review.json");
			writeFileSync(forgedArtifactPath, `${JSON.stringify({
				...initialArtifact,
				findings: initialArtifact.findings.map((finding: Record<string, unknown>) => ({
					...finding,
					summary: "caller-forged closure authority",
				})),
			})}\n`);
			const forgedClosure = spawnInstalledRuntime(
				marker.argvPrefix[0],
				[
					marker.argvPrefix[1],
					"review",
					"code",
					"--host",
					"codex",
					"--closure-artifact",
					forgedArtifactPath,
				],
				{
					cwd: repo,
					encoding: "utf8",
					env: {
						...process.env,
						HOME: join(fixture, "empty-home"),
						GOLDBAND_HOME: stateRoot,
						PATH: `${poisonBin}:${process.env.PATH ?? ""}`,
					},
				},
			);
			expect(forgedClosure.status).not.toBe(0);
			expect(forgedClosure.stderr).toMatch(/receipt|artifact/);

			writeFileSync(join(repo, "review-me.txt"), "repaired\n");
			const closure = spawnInstalledRuntime(
				marker.argvPrefix[0],
				[
					marker.argvPrefix[1],
					"review",
					"code",
					"--host",
					"codex",
					"--closure-artifact",
					initialArtifactPath!,
				],
				{
					cwd: repo,
					encoding: "utf8",
					env: {
						...process.env,
						HOME: join(fixture, "empty-home"),
						GOLDBAND_HOME: stateRoot,
						PATH: `${poisonBin}:${process.env.PATH ?? ""}`,
					},
				},
			);
			expect(
				closure.status,
				`closure stdout:\n${closure.stdout}\nclosure stderr:\n${closure.stderr}`,
			).toBe(0);
			expect(closure.stdout).toContain("Phase: closure.");
			expect(closure.stdout).toContain("[closed] S-001");
			const closureResult = JSON.parse(closure.stdout) as { artifacts: string[] };
			const closureArtifactPath = closureResult.artifacts.find((file) =>
				file.endsWith("-review-closure.json"));
			expect(closureArtifactPath).toBeDefined();
			const closureArtifact = JSON.parse(readFileSync(closureArtifactPath!, "utf8"));
			expect(closureArtifact).toMatchObject({
				phase: "closure",
				hostCallCount: 1,
				results: [{ findingId: "S-001", status: "closed" }],
			});

			const browser = spawnInstalledRuntime(
				marker.argvPrefix[0],
				[
					marker.argvPrefix[1],
					"browser",
					"session",
					"--host",
					"codex",
					"status",
				],
				{
					cwd: repo,
					encoding: "utf8",
					env: {
						...process.env,
						HOME: join(fixture, "empty-home"),
						GOLDBAND_HOME: stateRoot,
						GOLDBAND_ROOT: poisonRoot,
						GOLDBAND_TRUSTED_BROWSER_EXECUTABLE: poisonCodex,
					},
				},
			);
			expect(browser.status).toBe(0);
			expect(browser.stdout).toContain("browser-ok:status");
			expect(browser.stdout).toContain('"status": "completed"');
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	}, 30_000);

	test("rejects a trusted runtime inside the writable source", () => {
		const fixture = mkdtempSync(join(tmpdir(), "goldband-codex-review-reject-"));
		try {
			expect(() =>
				installCodexReviewLauncher({
					sourceRoot,
					runtimeRoot: join(sourceRoot, ".unsafe-review-runtime"),
					ruleFile: join(fixture, "rule.rules"),
					markerFile: join(fixture, "marker.json"),
					bunPath,
					codexPath: Bun.which("codex") ?? bunPath,
					browserPath: bunPath,
					bundleBrowserServer: (_bun, _entry, outputDirectory) => {
						mkdirSync(outputDirectory, { recursive: true });
						writeFileSync(join(outputDirectory, "server.js"), "// fixture\n");
					},
				}),
			).toThrow("must be outside the Goldband source workspace");
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});

	test("restores the previous runtime when replacement fails after backup", () => {
		const fixture = mkdtempSync(join(tmpdir(), "goldband-codex-review-rollback-"));
		try {
			const runtimeRoot = join(fixture, "runtime");
			const options = {
				sourceRoot,
				runtimeRoot,
				ruleFile: join(fixture, "rules", "goldband.rules"),
				markerFile: join(fixture, "skills", "goldband", ".workflow-launcher.json"),
				bunPath,
				codexPath: bunPath,
				browserPath: bunPath,
				bundleBrowserServer: (_bun: string, _entry: string, outputDirectory: string) => {
					mkdirSync(outputDirectory, { recursive: true });
					writeFileSync(join(outputDirectory, "server.js"), "// fixture\n");
				},
			};
			installCodexReviewLauncher(options);
			const receiptKeyFile = join(dirname(runtimeRoot), "review-receipt.key");
			const receiptKey = readFileSync(receiptKeyFile, "utf8");
			writeFileSync(join(runtimeRoot, "healthy-runtime"), "preserve me\n");

			expect(() =>
				installCodexReviewLauncher({
					...options,
					afterRuntimeBackup: () => {
						throw new Error("injected swap failure");
					},
				}),
			).toThrow("injected swap failure");
			expect(readFileSync(join(runtimeRoot, "healthy-runtime"), "utf8")).toBe(
				"preserve me\n",
			);
			expect(existsSync(`${runtimeRoot}.backup`)).toBe(false);
			installCodexReviewLauncher(options);
			expect(readFileSync(receiptKeyFile, "utf8")).toBe(receiptKey);
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});

	test("an execpolicy probe matches only trusted review and browser prefixes", () => {
		const codex = Bun.which("codex");
		if (!codex) return;
		const fixture = mkdtempSync(join(tmpdir(), "goldband-codex-rule-probe-"));
		try {
			const launcher = join(fixture, "trusted", "bin", "goldband.js");
			const ruleFile = join(fixture, "goldband-workflows.rules");
			mkdirSync(join(fixture, "trusted", "bin"), { recursive: true });
			writeFileSync(launcher, "// fixture\n");
			const marker = {
				schemaVersion: 1 as const,
				argvPrefix: [bunPath, launcher] as [string, string],
				ruleFile,
				runtimeRoot: join(fixture, "trusted"),
			};
			writeFileSync(ruleFile, renderCodexReviewRule(marker));

			const probe = (argv: string[]) => {
				const result = spawnSync(
					codex,
					["execpolicy", "check", "--rules", ruleFile, "--", ...argv],
					{ encoding: "utf8" },
				);
				expect(result.status).toBe(0);
				return JSON.parse(result.stdout);
			};

			expect(
				probe([...marker.argvPrefix, "review", "code", "--host", "codex"])
					.decision,
			).toBe("allow");
			expect(
				probe([...marker.argvPrefix, "browser", "session", "--host", "codex", "status"])
					.decision,
			).toBe("allow");
			expect(
				probe([
					...marker.argvPrefix,
					"browser",
					"session",
					"--host",
					"codex",
					"goto",
					"http://127.0.0.1:43123/private",
				]).decision,
			).toBeUndefined();
			expect(
				probe([bunPath, join(sourceRoot, "bin", "goldband.ts"), "review", "code", "--host", "codex"])
					.decision,
			).toBeUndefined();
			expect(
				probe([...marker.argvPrefix, "worktree", "create", "unsafe"]).decision,
			).toBeUndefined();
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});
});

function installedReviewEvidenceManifest(nestedEvidenceSandbox = false) {
	if (nestedEvidenceSandbox) {
		return {
			schemaVersion: 1,
			behaviorMatrix: [{
				id: "installed-review",
				behavior: "The installed runtime persists evidence-first phases and a runtime-owned receipt.",
				kind: "boundary",
				input: "installed fixture candidate inside an outer evidence sandbox",
				preconditions: "nested macOS Seatbelt profiles are unavailable",
				expected: "the installed initial artifact and receipt are persisted without recursive evidence execution",
				risk: "high",
				disposition: "unsupported",
				providerIds: [],
				reason: "Executable evidence is owned by the already-active outer sandbox; this smoke verifies installed phase and receipt wiring without nesting Seatbelt.",
			}],
			providers: [],
			authorizations: [],
		};
	}
	return {
		schemaVersion: 1,
		behaviorMatrix: [{
			id: "installed-review",
			behavior: "The installed runtime executes declared evidence before review.",
			kind: "normal",
			input: "installed fixture candidate",
			preconditions: "Seatbelt runner is available",
			expected: "the fixture gate exits successfully",
			risk: "low",
			disposition: "static",
			providerIds: ["installed-gate"],
		}],
		providers: [{
			id: "installed-gate",
			owner: "codex-review-launcher-install.test.ts",
			kind: "static",
			cellIds: ["installed-review"],
			changedPathPrefixes: [],
			operations: [{
				id: "pass",
				target: "candidate",
				argv: ["true"],
				expectedExit: "zero",
				timeoutMs: 10000,
				maxOutputBytes: 1024,
				network: "deny",
				evidenceLevel: "fixture",
			}],
		}],
		authorizations: [],
	};
}
