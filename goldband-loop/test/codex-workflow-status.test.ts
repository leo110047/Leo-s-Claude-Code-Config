import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const statusScript = resolve(import.meta.dir, "../..", "shell/install/status.sh");

describe("trusted Codex workflow status", () => {
	test("probes the pinned Codex executable and rejects it when missing", () => {
		const fixture = mkdtempSync(join(tmpdir(), "goldband-codex-status-"));
		try {
			const home = join(fixture, "home");
			const runtimeRoot = join(home, ".codex", "goldband", "workflow-runtime");
			const skillRoot = join(home, ".codex", "skills", "goldband");
			const rulesRoot = join(home, ".codex", "rules");
			const trustedBin = join(fixture, "trusted-bin");
			const poisonBin = join(fixture, "poison-bin");
			for (const directory of [
				join(runtimeRoot, "bin"),
				join(runtimeRoot, "browse", "server"),
				skillRoot,
				rulesRoot,
				trustedBin,
				poisonBin,
			]) mkdirSync(directory, { recursive: true });

			const pinnedLog = join(fixture, "pinned.log");
			const poisonLog = join(fixture, "poison.log");
			const pinnedCodex = join(trustedBin, "codex");
			const poisonCodex = join(poisonBin, "codex");
			const bunExecutable = join(trustedBin, "bun");
			const browserExecutable = join(runtimeRoot, "browse", "browse");
			const browserServer = join(runtimeRoot, "browse", "server", "server.js");
			const launcher = join(runtimeRoot, "bin", "goldband.js");
			const rule = join(rulesRoot, "goldband-workflows.rules");
			for (const executable of [bunExecutable, browserExecutable]) {
				writeFileSync(executable, "#!/usr/bin/env bash\nexit 0\n");
				chmodSync(executable, 0o755);
			}
			writeFileSync(launcher, "// fixture\n");
			writeFileSync(browserServer, "// fixture\n");
			writeFileSync(rule, "# fixture\n");
			writeFileSync(
				pinnedCodex,
				"#!/usr/bin/env bash\nprintf 'pinned\\n' >> \"$PINNED_LOG\"\nprintf '{\"decision\":\"allow\"}\\n'\n",
			);
			writeFileSync(
				poisonCodex,
				"#!/usr/bin/env bash\nprintf 'poison\\n' >> \"$POISON_LOG\"\nexit 97\n",
			);
			chmodSync(pinnedCodex, 0o755);
			chmodSync(poisonCodex, 0o755);
			writeFileSync(
				join(runtimeRoot, "trusted-runtime.json"),
				JSON.stringify({
					schemaVersion: 1,
					bunExecutable,
					codexExecutable: pinnedCodex,
					browserExecutable,
					browserServerScript: browserServer,
				}),
			);
			writeFileSync(
				join(skillRoot, ".workflow-launcher.json"),
				JSON.stringify({
					schemaVersion: 1,
					argvPrefix: [bunExecutable, launcher],
					ruleFile: rule,
					runtimeRoot,
				}),
			);

			const runStatus = () => spawnSync(
				"bash",
				[
					"-c",
					'source "$1"; RED=""; GREEN=""; YELLOW=""; NC=""; GOLDBAND_STATUS_EXIT_CODE=0; show_codex_workflow_launcher_status',
					"status-test",
					statusScript,
				],
				{
					encoding: "utf8",
					env: {
						...process.env,
						HOME: home,
						PATH: `${poisonBin}:${process.env.PATH ?? ""}`,
						PINNED_LOG: pinnedLog,
						POISON_LOG: poisonLog,
					},
				},
			);

			const healthy = runStatus();
			expect(healthy.status).toBe(0);
			expect(healthy.stdout).toContain("[OK] trusted Codex workflow launcher");
			expect(readFileSync(pinnedLog, "utf8").trim().split("\n")).toHaveLength(2);
			expect(() => readFileSync(poisonLog, "utf8")).toThrow();

			unlinkSync(pinnedCodex);
			const stale = runStatus();
			expect(stale.stdout).toContain("[stale] trusted Codex workflow launcher");
			expect(stale.stdout).not.toContain("[OK] trusted Codex workflow launcher");
			expect(() => readFileSync(poisonLog, "utf8")).toThrow();
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});
});
