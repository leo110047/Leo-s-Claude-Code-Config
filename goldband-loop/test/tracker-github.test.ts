import { describe, expect, test } from "bun:test";
import { GitHubTrackerAdapter } from "../workflows/tracker-adapters/github";
import type { TrackerCommandRunner } from "../workflows/tracker-adapters/types";
import { sampleWorkMap } from "./tracker-test-helpers";

describe("GitHub tracker adapter", () => {
	test("uses argument arrays and verifies a complete projection round trip", async () => {
		const fake = githubFake();
		const adapter = new GitHubTrackerAdapter({ repository: "owner/repo", runner: fake.runner, defaultLabels: ["team-owned"], dependencyCapability: "body-links" });
		const plan = await adapter.previewProjection(sampleWorkMap());
		const approved: string[] = [];
		const result = await adapter.publish(plan, ({ stepId }) => { approved.push(stepId); });
		expect(result.status).toBe("completed");
		expect(result.remote?.mapIssue).not.toBeNull();
		expect(Object.keys(result.remote?.ticketIssues ?? {})).toEqual(["ticket-1", "ticket-2"]);
		expect(result.remote?.mapIssue?.labels).toContain("team-owned");
		expect(approved).toEqual(plan.steps.map((step) => step.id));
		expect(fake.calls.every((call) => Array.isArray(call.args))).toBe(true);
		expect(fake.calls.some((call) => call.args.join(" ").includes("sh -c"))).toBe(false);
		expect((await adapter.previewProjection(sampleWorkMap())).steps).toEqual([]);
		(fake.issues[1].labels as Array<{ name: string }>).push({ name: "goldband:status:verified" });
		const repair = await adapter.previewProjection(sampleWorkMap());
		expect(repair.steps.some((step) => step.id === "update:ticket:ticket-1")).toBe(true);
		await adapter.publish(repair, () => {});
		expect((fake.issues[1].labels as Array<{ name: string }>).map((label) => label.name)).not.toContain("goldband:status:verified");
	});

	test("stops on duplicate remote markers", async () => {
		const fake = githubFake();
		const adapter = new GitHubTrackerAdapter({ repository: "owner/repo", runner: fake.runner });
		const plan = await adapter.previewProjection(sampleWorkMap());
		await adapter.publish(plan, () => {});
		fake.issues.push({ ...fake.issues[0], number: 99, url: "https://github.test/99" });
		await expect(adapter.inspectRemote("work-1")).rejects.toThrow("duplicate remote Work Map marker");
	});

	test("checkpoints a successful create before transient readback failure", async () => {
		const fake = githubFake();
		fake.failNextListAfterCreate = true;
		const adapter = new GitHubTrackerAdapter({ repository: "owner/repo", runner: fake.runner, dependencyCapability: "body-links" });
		const plan = await adapter.previewProjection(sampleWorkMap());
		const first = await adapter.publish(plan, () => {});
		expect(first.completedSteps).toEqual(["create:map"]);
		const second = await adapter.publish(plan, () => {}, { completedSteps: first.completedSteps });
		expect(second.status).toBe("completed");
		expect(fake.calls.filter((call) => call.args[0] === "issue" && call.args[1] === "create" && call.args.includes("Work Map: Ship collaboration adapters"))).toHaveLength(1);
	});
});

function githubFake() {
	const issues: Array<Record<string, unknown>> = [];
	const calls: Array<{ command: string; args: readonly string[] }> = [];
	let created = false;
	const control = { failNextListAfterCreate: false };
	const runner: TrackerCommandRunner = (command, args) => {
		calls.push({ command, args: [...args] });
		if (args[0] === "--version" || args[0] === "auth" || args[0] === "repo") return ok("{}");
		if (args[0] === "issue" && args[1] === "list") {
			if (created && control.failNextListAfterCreate) { control.failNextListAfterCreate = false; return { status: 1, stdout: "", stderr: "transient readback failure" }; }
			return ok(JSON.stringify(issues));
		}
		if (args[0] === "issue" && args[1] === "create") {
			const number = issues.length + 1;
			issues.push({ number, url: `https://github.test/${number}`, title: flag(args, "--title"), body: flag(args, "--body"), state: "OPEN", labels: flags(args, "--label").map((name) => ({ name })), assignees: [], comments: [] });
			created = true;
			return ok(`https://github.test/${number}`);
		}
		if (args[0] === "issue" && args[1] === "edit") {
			const issue = byNumber(issues, args[2]);
			if (args.includes("--title")) issue.title = flag(args, "--title");
			if (args.includes("--body")) issue.body = flag(args, "--body");
			const current = (issue.labels as Array<{ name: string }>).map((label) => label.name);
			for (const label of flags(args, "--add-label")) if (!current.includes(label)) current.push(label);
			for (const label of flags(args, "--remove-label")) current.splice(current.indexOf(label), current.includes(label) ? 1 : 0);
			issue.labels = current.map((name) => ({ name }));
			return ok("");
		}
		if (args[0] === "issue" && (args[1] === "close" || args[1] === "reopen")) {
			byNumber(issues, args[2]).state = args[1] === "close" ? "CLOSED" : "OPEN";
			return ok("");
		}
		if (args[0] === "api") return ok("{}");
		return { status: 1, stdout: "", stderr: `unexpected ${command} ${args.join(" ")}` };
	};
	return { issues, calls, runner, get failNextListAfterCreate() { return control.failNextListAfterCreate; }, set failNextListAfterCreate(value: boolean) { control.failNextListAfterCreate = value; } };
}

function flag(args: readonly string[], name: string): string {
	const index = args.indexOf(name); if (index < 0) throw new Error(`missing ${name}`); return args[index + 1] as string;
}
function flags(args: readonly string[], name: string): string[] { return args.flatMap((item, index) => item === name ? [args[index + 1] as string] : []); }
function byNumber(issues: Array<Record<string, unknown>>, value: string): Record<string, unknown> { const issue = issues.find((item) => String(item.number) === value); if (!issue) throw new Error("missing issue"); return issue; }
function ok(stdout: string) { return { status: 0, stdout, stderr: "" }; }
