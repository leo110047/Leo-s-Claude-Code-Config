import * as fs from "node:fs";
import * as path from "node:path";
import type { ManagedWorktreeLease } from "./managed-worktree-contract";
import { removePathIfExists } from "./managed-worktree-contract";
import {
	type CommandResult,
	type GitExecutionContext,
	gitOk,
	gitOutput,
	gitRun,
	withGitEnvironment,
} from "./managed-worktree-git";

export interface PreparedManagedCommit {
	commit: string;
	tree: string;
	indexPath: string;
	objectDirectory: string;
	context: GitExecutionContext;
}

export function prepareManagedCommit(
	lease: ManagedWorktreeLease,
	message: string,
	context: GitExecutionContext,
): PreparedManagedCommit {
	const indexPath = path.join(lease.scratchPath, "finish.index");
	const objectDirectory = path.join(lease.scratchPath, "objects");
	removePathIfExists(indexPath);
	removePathIfExists(objectDirectory);
	fs.mkdirSync(objectDirectory, { recursive: true, mode: 0o700 });
	if (process.platform !== "win32") fs.chmodSync(objectDirectory, 0o700);
	const preparedContext = withGitEnvironment(context, {
		GIT_INDEX_FILE: indexPath,
		GIT_OBJECT_DIRECTORY: objectDirectory,
		GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(lease.commonGitDir, "objects"),
	});

	gitOk(["read-tree", lease.baseCommit], lease.worktreePath, preparedContext);
	gitOk(["add", "-A", "--", "."], lease.worktreePath, preparedContext);
	const tree = gitOutput(["write-tree"], lease.worktreePath, preparedContext);
	const baseTree = gitOutput(
		["rev-parse", `${lease.baseCommit}^{tree}`],
		lease.worktreePath,
		preparedContext,
	);
	if (tree === baseTree) {
		throw new Error("managed worktree has no changes to finish");
	}
	const result = gitRun(
		["commit-tree", tree, "-p", lease.baseCommit],
		lease.worktreePath,
		preparedContext,
		`${message}\n`,
	);
	if (result.status !== 0) {
		throw new Error("failed to prepare managed commit in quarantine");
	}
	const commit = result.stdout.trim();
	if (!/^[0-9a-f]{40,64}$/.test(commit)) {
		throw new Error("git commit-tree returned an invalid commit id");
	}
	return { commit, tree, indexPath, objectDirectory, context: preparedContext };
}

export function integratePreparedCommit(
	lease: ManagedWorktreeLease,
	prepared: PreparedManagedCommit,
): CommandResult {
	const receiver = [
		prepared.context.executable,
		"-c",
		`core.hooksPath=${lease.broker.hookRoot}`,
		"-c",
		"core.fsmonitor=false",
		"-c",
		"receive.denyCurrentBranch=updateInstead",
		"-c",
		"receive.denyNonFastForwards=true",
		"receive-pack",
	]
		.map(shellQuote)
		.join(" ");
	return gitRun(
		[
			"push",
			"--porcelain",
			"--no-verify",
			`--receive-pack=${receiver}`,
			lease.repoRoot,
			`${prepared.commit}:${lease.sourceBranch}`,
		],
		lease.worktreePath,
		prepared.context,
	);
}

export function discardPreparedCommit(
	prepared: Pick<PreparedManagedCommit, "indexPath" | "objectDirectory">,
): void {
	removePathIfExists(prepared.indexPath);
	removePathIfExists(prepared.objectDirectory);
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}
