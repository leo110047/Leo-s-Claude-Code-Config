import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	buildReviewRuntimeArgs,
	prepareReviewProcessEnvironment,
	resolveReviewRuntimeFile,
} from "../bin/goldband.ts";

describe("goldband review code launcher", () => {
	test("runs the real typed pipeline through the Codex host adapter", () => {
		const fixture = mkdtempSync(join(tmpdir(), "goldband-review-e2e-"));
		try {
			const fakeBin = join(fixture, "bin");
			const fakeCodex = join(fakeBin, "codex");
			const callLog = join(fixture, "codex-calls.log");
			const repo = join(fixture, "repo");
			const stateRoot = join(fixture, "state");
			mkdirSync(fakeBin, { recursive: true });
			mkdirSync(repo, { recursive: true });
			writeFileSync(
				fakeCodex,
				[
					"#!/usr/bin/env bash",
					"set -euo pipefail",
					'output=""',
					'approval=""',
					'sandbox=""',
					'printf "%s\\n" call >> "$GOLDBAND_TEST_CALL_LOG"',
					'while [ "$#" -gt 0 ]; do',
					'  if [ "$1" = "-o" ]; then output="$2"; shift 2; continue; fi',
					'  if [ "$1" = "--ask-for-approval" ]; then approval="$2"; shift 2; continue; fi',
					'  if [ "$1" = "--sandbox" ]; then sandbox="$2"; shift 2; continue; fi',
					"  shift",
					"done",
					'test -n "$output"',
					'test "$approval" = "never"',
					'test "$sandbox" = "read-only"',
					'printf \'%s\\n\' \'{"findings":[]}\' > "$output"',
				].join("\n"),
			);
			chmodSync(fakeCodex, 0o755);
			spawnSync("git", ["init"], { cwd: repo });
			writeFileSync(join(repo, "new-file.txt"), "review me\n");

			const result = spawnSync(
				resolve(import.meta.dir, "../bin/goldband"),
				[
					"review",
					"code",
					"--host",
					"codex",
					"--review-host-timeout-seconds",
					"240",
					"--review-pass-timeout-seconds",
					"600",
				],
				{
					cwd: repo,
					encoding: "utf8",
					env: {
						...process.env,
						GOLDBAND_HOME: stateRoot,
						GOLDBAND_TEST_CALL_LOG: callLog,
						PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
					},
				},
			);

			expect(result.status).toBe(0);
			expect(result.stdout).toContain("No findings.");
			expect(result.stdout).toContain("review/code runtime report");
			const telemetryDir = join(stateRoot, "workflow-runs", "telemetry");
			const telemetryFile = readdirSync(telemetryDir).find((file) =>
				file.endsWith("-review-prompt.json"),
			);
			expect(telemetryFile).toBeDefined();
			const telemetry = JSON.parse(
				readFileSync(join(telemetryDir, telemetryFile as string), "utf8"),
			);
			expect(telemetry.host).toBe("codex");
			expect(telemetry.hostTimeoutMs).toBe(240_000);
			expect(telemetry.passTimeoutMs).toBe(600_000);
			expect(telemetry.specialistMode).toBe("off");
			expect(telemetry.selectedSpecialists).toEqual([]);
			expect(readFileSync(callLog, "utf8").trim().split("\n")).toHaveLength(1);
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});

	test("forces real Codex review and defaults to the whole worktree", () => {
		expect(buildReviewRuntimeArgs(["--host", "codex"])).toEqual([
			"review",
			"code",
			"--mode",
			"real",
			"--host",
			"codex",
			"--worktree",
		]);
	});

	test("preserves explicit scope and loop options", () => {
		expect(
			buildReviewRuntimeArgs([
				"--host",
				"codex",
				"--base",
				"origin/main",
				"--loop",
			]),
		).toEqual([
			"review",
			"code",
			"--mode",
			"real",
			"--host",
			"codex",
			"--base",
			"origin/main",
			"--loop",
		]);
	});

	test("rejects independent specialist agents before launching the runtime", () => {
		for (const mode of ["auto", "all"]) {
			expect(() =>
				buildReviewRuntimeArgs([
					"--host",
					"codex",
					"--specialists",
					mode,
				]),
			).toThrow("independent specialist agents are disabled");
		}
	});

	test("rejected specialist mode starts zero Codex processes", () => {
		const fixture = mkdtempSync(join(tmpdir(), "goldband-review-blocked-fanout-"));
		try {
			const fakeBin = join(fixture, "bin");
			const fakeCodex = join(fakeBin, "codex");
			const callLog = join(fixture, "codex-calls.log");
			mkdirSync(fakeBin, { recursive: true });
			writeFileSync(
				fakeCodex,
				`#!/usr/bin/env bash\nprintf '%s\\n' call >> "${callLog}"\n`,
			);
			chmodSync(fakeCodex, 0o755);

			const result = spawnSync(
				resolve(import.meta.dir, "../bin/goldband"),
				["review", "code", "--host", "codex", "--specialists", "auto"],
				{
					cwd: fixture,
					encoding: "utf8",
					env: {
						...process.env,
						PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
					},
				},
			);

			expect(result.status).toBe(1);
			expect(result.stderr).toContain("independent specialist agents are disabled");
			expect(existsSync(callLog)).toBe(false);
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});

	test("rejects conflicting review scopes before launching the runtime", () => {
		for (const scopes of [
			["--staged", "--diff-file", "empty.diff"],
			["--worktree", "--diff-file", "empty.diff"],
			["--base", "origin/main", "--diff-file", "empty.diff"],
			["--staged", "--worktree"],
			["--staged", "--base", "origin/main"],
			["--diff-file", "empty.diff", "--include-untracked"],
		]) {
			expect(() =>
				buildReviewRuntimeArgs(["--host", "codex", ...scopes]),
			).toThrow("conflicting review scope flags");
		}
	});

	test("forwards explicit review timeout overrides", () => {
		expect(
			buildReviewRuntimeArgs([
				"--host",
				"codex",
				"--review-host-timeout-seconds",
				"240",
				"--review-pass-timeout-seconds",
				"600",
			]),
		).toEqual([
			"review",
			"code",
			"--mode",
			"real",
			"--host",
			"codex",
			"--worktree",
			"--review-host-timeout-seconds",
			"240",
			"--review-pass-timeout-seconds",
			"600",
		]);
	});

	test("rejects missing hosts and attempts to downgrade into mock mode", () => {
		expect(() => buildReviewRuntimeArgs([])).toThrow(
			"review code requires --host claude or --host codex",
		);
		expect(() =>
			buildReviewRuntimeArgs(["--host", "codex", "--mode", "mock"]),
		).toThrow("review code always uses real mode");
	});

	test("falls back to a private temporary evidence root when the default root is sandbox-blocked", () => {
		const fixture = mkdtempSync(join(tmpdir(), "goldband-review-fallback-"));
		try {
			const temporaryRoot = join(fixture, "temporary-state");
			mkdirSync(temporaryRoot, { recursive: true });
			const probed: string[] = [];
			const result = prepareReviewProcessEnvironment(
				{},
				{
					home: join(fixture, "blocked-home"),
					createTemporaryRoot: () => temporaryRoot,
					probeStateRoot: (root) => {
						probed.push(root);
						if (root !== temporaryRoot) {
							throw Object.assign(new Error("sandbox blocked"), {
								code: "EPERM",
							});
						}
					},
				},
			);

			expect(result.durability).toBe("ephemeral");
			expect(result.evidenceRoot).toBe(temporaryRoot);
			expect(result.env.GOLDBAND_HOME).toBe(temporaryRoot);
			expect(result.env.GOLDBAND_REVIEW_EVIDENCE_DURABILITY).toBe(
				"ephemeral",
			);
			expect(probed).toEqual([
				join(fixture, "blocked-home", ".goldband"),
				temporaryRoot,
			]);
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});

	test("does not hide an unwritable explicitly configured evidence root", () => {
		const blocked = Object.assign(new Error("configured root blocked"), {
			code: "EPERM",
		});
		expect(() =>
			prepareReviewProcessEnvironment(
				{ GOLDBAND_HOME: "/configured/state" },
				{ probeStateRoot: () => { throw blocked; } },
			),
		).toThrow("configured root blocked");
	});

	test("resolves a copied runtime through its installed source marker", () => {
		const fixture = mkdtempSync(join(tmpdir(), "goldband-review-launcher-"));
		try {
			const sourceRoot = join(fixture, "source");
			const runtimeRoot = join(fixture, "installed");
			const entryFile = join(runtimeRoot, "bin", "goldband.ts");
			const runtimeFile = join(sourceRoot, "workflows", "run.ts");
			mkdirSync(join(runtimeRoot, "bin"), { recursive: true });
			mkdirSync(join(sourceRoot, "workflows"), { recursive: true });
			writeFileSync(entryFile, "// fixture\n");
			writeFileSync(runtimeFile, "// fixture\n");
			writeFileSync(join(runtimeRoot, ".installed-source"), `${sourceRoot}\n`);

			expect(
				resolveReviewRuntimeFile({ entryFile, env: {} }),
			).toBe(runtimeFile);
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});
});
