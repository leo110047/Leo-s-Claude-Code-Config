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
import { join, resolve } from "node:path";
import {
	installCodexReviewLauncher,
	renderCodexReviewRule,
} from "../scripts/install-codex-review-launcher.ts";

const sourceRoot = resolve(import.meta.dir, "..");
const bunPath = process.execPath;

describe("Codex trusted workflow launcher install", () => {
	test("materializes review and browser owners with exact allow rules outside source", () => {
		const fixture = mkdtempSync(join(tmpdir(), "goldband-codex-review-install-"));
		try {
			const trustedBin = join(fixture, "trusted-bin");
			const poisonBin = join(fixture, "poison-bin");
			mkdirSync(trustedBin, { recursive: true });
			mkdirSync(poisonBin, { recursive: true });
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
					'printf \'%s\\n\' \'{"findings":[]}\' > "$output"',
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

			expect(marker.argvPrefix).toEqual([
				bunPath,
				join(runtimeRoot, "bin", "goldband.js"),
			]);
			expect(existsSync(join(runtimeRoot, "workflows", "run.ts"))).toBe(true);
			expect(existsSync(join(runtimeRoot, "browse", "browse"))).toBe(true);
			expect(existsSync(join(runtimeRoot, "browse", "server", "server.js"))).toBe(true);
			expect(existsSync(join(runtimeRoot, "review", "shared-rubric.md"))).toBe(true);
			expect(readFileSync(join(runtimeRoot, "trusted-runtime.json"), "utf8")).toContain('"browserExecutable"');
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
			spawnSync("git", ["init"], { cwd: repo });
			writeFileSync(join(repo, "review-me.txt"), "change\n");
			const review = spawnSync(
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
						GOLDBAND_HOME: stateRoot,
						GOLDBAND_ROOT: poisonRoot,
						PATH: `${poisonBin}:${process.env.PATH ?? ""}`,
					},
				},
			);
			expect(review.status).toBe(0);
			expect(review.stdout).toContain("No findings.");
			expect(review.stdout).toContain("review/code runtime report");

			const browser = spawnSync(
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
	});

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
