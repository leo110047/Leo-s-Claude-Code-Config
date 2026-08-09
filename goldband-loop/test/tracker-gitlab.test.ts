import { describe, expect, test } from "bun:test";
import { GitLabTrackerAdapter } from "../workflows/tracker-adapters/gitlab";
import type { TrackerCommandRunner } from "../workflows/tracker-adapters/types";
import { sampleWorkMap } from "./tracker-test-helpers";

describe("GitLab tracker adapter", () => {
	test("uses glab argument arrays and verifies create, link fallback, and readback", async () => {
		const fake = gitlabFake();
		const adapter = new GitLabTrackerAdapter({ repository: "group/project", runner: fake.runner, dependencyCapability: "body-links" });
		const plan = await adapter.previewProjection(sampleWorkMap());
		const result = await adapter.publish(plan, () => {});
		expect(result.status).toBe("completed");
		expect(Object.keys(result.remote?.ticketIssues ?? {})).toHaveLength(2);
		expect(fake.calls.every((call) => call.command === "glab")).toBe(true);
		expect(fake.calls.some((call) => call.args[0] === "issue" && call.args[1] === "update" && call.args.includes("--description"))).toBe(true);
	});

	test("fails clearly when auth is unavailable", async () => {
		const runner: TrackerCommandRunner = (_command, args) => args[0] === "auth" ? { status: 1, stdout: "", stderr: "not logged in" } : { status: 0, stdout: "", stderr: "" };
		const adapter = new GitLabTrackerAdapter({ repository: "group/project", runner });
		await expect(adapter.previewProjection(sampleWorkMap())).rejects.toThrow("authentication unavailable");
	});
});

function gitlabFake() {
	const issues: Array<Record<string, unknown>> = [];
	const calls: Array<{ command: string; args: readonly string[] }> = [];
	const runner: TrackerCommandRunner = (command, args) => {
		calls.push({ command, args: [...args] });
		if (args[0] === "--version" || args[0] === "auth" || args[0] === "repo") return ok("{}");
		if (args[0] === "issue" && args[1] === "list") return ok(JSON.stringify(issues));
		if (args[0] === "issue" && args[1] === "create") {
			const iid = issues.length + 1;
			issues.push({ iid, web_url: `https://gitlab.test/${iid}`, title: flag(args, "--title"), description: flag(args, "--description"), state: "opened", labels: flags(args, "--label"), assignees: [] });
			return ok(JSON.stringify({ iid }));
		}
		if (args[0] === "issue" && args[1] === "update") {
			const issue = byIid(issues, args[2]);
			if (args.includes("--title")) issue.title = flag(args, "--title");
			if (args.includes("--description")) issue.description = flag(args, "--description");
			if (args.includes("--state")) issue.state = flag(args, "--state") === "close" ? "closed" : "opened";
			const current = [...(issue.labels as string[])];
			for (const label of flags(args, "--label")) if (!current.includes(label)) current.push(label);
			for (const label of flags(args, "--unlabel")) current.splice(current.indexOf(label), current.includes(label) ? 1 : 0);
			issue.labels = current;
			return ok("");
		}
		if (args[0] === "api") return ok(String(args[1]).endsWith("/notes") ? "[]" : "{}");
		return { status: 1, stdout: "", stderr: `unexpected ${command} ${args.join(" ")}` };
	};
	return { calls, runner };
}

function flag(args: readonly string[], name: string): string { const index = args.indexOf(name); if (index < 0) throw new Error(`missing ${name}`); return args[index + 1] as string; }
function flags(args: readonly string[], name: string): string[] { return args.flatMap((item, index) => item === name ? [args[index + 1] as string] : []); }
function byIid(issues: Array<Record<string, unknown>>, value: string): Record<string, unknown> { const issue = issues.find((item) => String(item.iid) === value); if (!issue) throw new Error("missing issue"); return issue; }
function ok(stdout: string) { return { status: 0, stdout, stderr: "" }; }
