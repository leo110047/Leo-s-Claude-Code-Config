#!/usr/bin/env bun

import {
	abortCreatedManagedWorktree,
	createManagedWorktree,
	finishManagedWorktree,
} from "../lib/managed-worktree";
import {
	defaultManagedShell,
	probeManagedBoundary,
	runManagedCommand,
} from "../lib/managed-worktree-boundary";

function printUsage(stream: Pick<Console, "log">): void {
	stream.log("Usage:");
	stream.log("  goldband worktree create <name>");
	stream.log('  goldband worktree finish <name> -m "<commit message>"');
}

function usage(): never {
	printUsage({ log: (message) => console.error(message) });
	process.exit(2);
}

function create(name: string | undefined, extra: string[]): number {
	if (!name || extra.length > 0) usage();
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		throw new Error(
			"worktree create requires an interactive terminal because the managed agent must inherit the sandboxed shell",
		);
	}

	const lease = createManagedWorktree({ name });
	const probe = probeManagedBoundary(lease);
	if (!probe.available) {
		abortCreatedManagedWorktree(lease);
		throw new Error(
			`hard enforcement boundary is unavailable (${probe.reason}): ${probe.detail || "probe failed"}`,
		);
	}

	console.log(`Managed worktree: ${lease.worktreePath}`);
	console.log(`Boundary: ${lease.enforcement.boundary}`);
	console.log(
		"Git metadata is read-only in the shell below. Working files remain writable.",
	);
	console.log(
		"Start the agent without a nested OS sandbox; the managed boundary remains authoritative:",
	);
	console.log(
		`  Claude Code: claude --settings '${JSON.stringify({ sandbox: { enabled: false } })}'`,
	);
	console.log("  Codex: codex --sandbox danger-full-access");
	console.log("Normal agent permissions and Goldband hooks remain active.");
	console.log("Exit this shell before running worktree finish.");
	const result = runManagedCommand(lease, [defaultManagedShell(), "-l"], {
		stdio: "inherit",
	});
	console.log(`Managed worktree preserved: ${lease.worktreePath}`);
	console.log(
		`Finish outside the managed shell: goldband worktree finish ${lease.name} -m "<message>"`,
	);
	return result.status ?? 1;
}

function finish(name: string | undefined, args: string[]): number {
	if (!name) usage();
	let message = "";
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "-m" || arg === "--message") {
			const value = args[index + 1];
			if (!value || message) usage();
			message = value;
			index += 1;
			continue;
		}
		usage();
	}
	if (!message) usage();

	const result = finishManagedWorktree({ name, message });
	console.log(`Integrated commit: ${result.commit}`);
	console.log(`Source branch: ${result.branch}`);
	console.log(`Evidence: ${result.evidencePath}`);
	return 0;
}

function main(): number {
	const [scope, action, name, ...rest] = process.argv.slice(2);
	if (scope === "-h" || scope === "--help" || scope === "help") {
		printUsage(console);
		return 0;
	}
	if (scope !== "worktree") usage();
	if (action === "create") return create(name, rest);
	if (action === "finish") return finish(name, rest);
	usage();
}

try {
	process.exitCode = main();
} catch (error) {
	console.error(
		`goldband: ${error instanceof Error ? error.message : String(error)}`,
	);
	process.exitCode = 1;
}
