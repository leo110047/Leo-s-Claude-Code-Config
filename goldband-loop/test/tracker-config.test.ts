import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	defaultTrackerConfiguration,
	inspectTrackerConfiguration,
	parseTrackerConfiguration,
	TrackerConfigurationStore,
} from "../workflows/tracker-config";

const cleanup: string[] = [];
afterEach(() => { for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe("tracker configuration", () => {
	test("defaults to local-only and does not execute a command", () => {
		let called = false;
		const result = inspectTrackerConfiguration(defaultTrackerConfiguration, () => { called = true; return { status: 0, stdout: "", stderr: "" }; });
		expect(result.provider).toBe("off");
		expect(called).toBe(false);
	});

	test("inspects CLI, auth, and repository in read-only order", () => {
		const calls: string[][] = [];
		const config = parseTrackerConfiguration({ schemaVersion: 1, mode: "github", repository: "owner/repo", defaultLabels: ["team"], dependencyCapability: "body-links" });
		const result = inspectTrackerConfiguration(config, (command, args) => { calls.push([command, ...args]); return { status: 0, stdout: "{}", stderr: "" }; });
		expect(result).toMatchObject({ provider: "github", authenticated: true, repositoryAccessible: true });
		expect(calls.map((call) => call.slice(0, 3))).toEqual([["gh", "--version"], ["gh", "auth", "status"], ["gh", "repo", "view"]]);
	});

	test("reports missing CLI and persists no token field", () => {
		const root = mkdtempSync(join(tmpdir(), "tracker-config-")); cleanup.push(root);
		const store = new TrackerConfigurationStore(root);
		const config = { schemaVersion: 1 as const, mode: "gitlab" as const, repository: "owner/repo", defaultLabels: [], dependencyCapability: "body-links" as const };
		expect(inspectTrackerConfiguration(config, () => ({ status: 1, stdout: "", stderr: "missing" }))).toMatchObject({ cliAvailable: false, blockedReason: "glab CLI unavailable" });
		store.write(config);
		expect(store.read()).toEqual(config);
		expect(readFileSync(store.path, "utf8")).not.toContain("token");
		expect(() => parseTrackerConfiguration({ ...config, token: "secret" })).toThrow("fields");
	});
});
