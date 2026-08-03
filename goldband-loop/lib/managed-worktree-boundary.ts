import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	type ManagedBoundary,
	type ManagedBoundaryProbe,
	type ManagedWorktreeLease,
	removePathIfExists,
} from "./managed-worktree-contract";
import { type CommandResult, cleanError } from "./managed-worktree-git";

const GIT_WRITE_ENV = [
	"GIT_DIR",
	"GIT_WORK_TREE",
	"GIT_INDEX_FILE",
	"GIT_OBJECT_DIRECTORY",
	"GIT_ALTERNATE_OBJECT_DIRECTORIES",
] as const;

export function detectManagedBoundary(): ManagedBoundary {
	if (process.platform === "darwin") {
		if (fs.existsSync("/usr/bin/sandbox-exec")) return "darwin-seatbelt";
		throw new Error(
			"hard enforcement unavailable: /usr/bin/sandbox-exec is missing",
		);
	}
	if (process.platform === "linux") {
		requireExecutable("bwrap");
		return "linux-bubblewrap";
	}
	throw new Error(
		`hard enforcement unavailable on ${process.platform}; managed worktree was not created`,
	);
}

export function runManagedCommand(
	lease: ManagedWorktreeLease,
	argv: string[],
	options: { stdio?: "pipe" | "inherit" } = {},
): CommandResult {
	if (argv.length === 0) throw new Error("managed command is required");
	const environment = managedEnvironment(lease);
	const stdio = options.stdio ?? "pipe";

	if (lease.enforcement.boundary === "darwin-seatbelt") {
		return spawnSync(
			"/usr/bin/sandbox-exec",
			["-p", darwinProfile(lease), "--", ...argv],
			{
				cwd: lease.worktreePath,
				env: environment,
				encoding: "utf8",
				stdio,
			},
		);
	}

	return spawnSync(
		requireExecutable("bwrap"),
		[
			"--die-with-parent",
			"--new-session",
			"--ro-bind",
			"/",
			"/",
			"--dev-bind",
			"/dev",
			"/dev",
			"--proc",
			"/proc",
			"--bind",
			lease.worktreePath,
			lease.worktreePath,
			"--bind",
			lease.agentScratchPath,
			lease.agentScratchPath,
			...(lease.workMap
				? [
						"--bind",
						path.join(lease.stateRoot, "projects"),
						path.join(lease.stateRoot, "projects"),
						"--bind",
						path.join(
							lease.stateRoot,
							"worktrees",
							"verification",
							path.basename(path.dirname(lease.evidencePath)),
							lease.id,
						),
						path.join(
							lease.stateRoot,
							"worktrees",
							"verification",
							path.basename(path.dirname(lease.evidencePath)),
							lease.id,
						),
					]
				: []),
			"--ro-bind",
			path.join(lease.worktreePath, ".git"),
			path.join(lease.worktreePath, ".git"),
			"--chdir",
			lease.worktreePath,
			"--",
			...argv,
		],
		{
			cwd: lease.worktreePath,
			env: environment,
			encoding: "utf8",
			stdio,
		},
	);
}

export function runManagedVerificationCommand(
	lease: ManagedWorktreeLease,
	argv: string[],
	options: { timeoutMs: number; maxBuffer: number },
) {
	if (argv.length === 0) throw new Error("managed verification command is required");
	const environment = managedVerificationEnvironment(lease);
	const spawnOptions = {
		cwd: lease.worktreePath,
		env: environment,
		encoding: "buffer" as const,
		timeout: options.timeoutMs,
		maxBuffer: options.maxBuffer,
		shell: false as const,
	};
	if (lease.enforcement.boundary === "darwin-seatbelt") {
		return spawnSync(
			"/usr/bin/sandbox-exec",
			["-p", darwinProfile(lease, false), "--", ...argv],
			spawnOptions,
		);
	}
	return spawnSync(
		requireExecutable("bwrap"),
		[
			"--die-with-parent",
			"--new-session",
			"--unshare-net",
			"--ro-bind",
			"/",
			"/",
			"--dev-bind",
			"/dev",
			"/dev",
			"--proc",
			"/proc",
			"--bind",
			lease.worktreePath,
			lease.worktreePath,
			"--bind",
			lease.agentScratchPath,
			lease.agentScratchPath,
			"--ro-bind",
			path.join(lease.worktreePath, ".git"),
			path.join(lease.worktreePath, ".git"),
			"--chdir",
			lease.worktreePath,
			"--",
			...argv,
		],
		spawnOptions,
	);
}

export function probeManagedBoundary(
	lease: ManagedWorktreeLease,
): ManagedBoundaryProbe {
	const workProbe = path.join(lease.worktreePath, ".goldband-boundary-probe");
	const scratchProbe = path.join(lease.agentScratchPath, "boundary-probe");
	const gitProbe = path.join(lease.worktreeGitDir, "goldband-write-probe");
	const commonProbe = path.join(lease.commonGitDir, "goldband-write-probe");
	const sourceProbe = path.join(lease.repoRoot, ".goldband-write-probe");
	const pointerProbe = path.join(lease.worktreePath, ".git");
	for (const probe of [
		workProbe,
		scratchProbe,
		gitProbe,
		commonProbe,
		sourceProbe,
	]) {
		removePathIfExists(probe);
	}

	const script = [
		"set -eu",
		'printf work > "$1"',
		'printf scratch > "$2"',
		'if printf blocked > "$3" 2>/dev/null; then exit 21; fi',
		'if printf blocked > "$4" 2>/dev/null; then exit 22; fi',
		'if printf blocked > "$5" 2>/dev/null; then exit 23; fi',
		'if touch "$6" 2>/dev/null; then exit 24; fi',
		'rm -f "$1" "$2"',
	].join("; ");
	const result = runManagedCommand(lease, [
		"/bin/sh",
		"-c",
		script,
		"goldband-boundary-probe",
		workProbe,
		scratchProbe,
		gitProbe,
		commonProbe,
		sourceProbe,
		pointerProbe,
	]);

	removePathIfExists(workProbe);
	removePathIfExists(scratchProbe);
	const output = cleanError(result);
	if (
		result.status === 71 ||
		/sandbox_apply|operation not permitted.*sandbox/i.test(output)
	) {
		return {
			available: false,
			reason: "nested-sandbox",
			detail: output,
		};
	}
	if (result.error || result.status === null) {
		return {
			available: false,
			reason: "unavailable",
			detail: output || result.error?.message,
		};
	}
	if (result.status !== 0) {
		return {
			available: false,
			reason: "contract-failed",
			detail: output || `boundary probe exited ${result.status}`,
		};
	}
	return { available: true, boundary: lease.enforcement.boundary };
}

function darwinProfile(
	lease: ManagedWorktreeLease,
	allowNetwork = true,
): string {
	const deniedDirectories = [
		lease.repoRoot,
		lease.commonGitDir,
		lease.worktreeGitDir,
		lease.scratchPath,
		path.join(lease.stateRoot, "worktrees", "leases"),
		path.join(lease.stateRoot, "worktrees", "locks"),
		path.join(lease.stateRoot, "worktrees", "evidence"),
		...lease.broker.protectedInputs
			.filter((input) => input.kind === "directory")
			.map((input) => input.path),
	];
	const directoryRules = [...new Set(deniedDirectories)]
		.flatMap((deniedPath) => [
			`(literal ${schemeString(deniedPath)})`,
			`(subpath ${schemeString(deniedPath)})`,
		])
		.join(" ");
	const deniedFiles = [
		path.join(lease.worktreePath, ".git"),
		...lease.broker.protectedInputs
			.filter((input) => input.kind === "file")
			.map((input) => input.path),
	];
	const fileRules = [...new Set(deniedFiles)]
		.map((deniedPath) => `(literal ${schemeString(deniedPath)})`)
		.join(" ");
	return `(version 1) (allow default) ${allowNetwork ? "" : "(deny network*)"} (deny file-write* ${directoryRules} ${fileRules})`;
}

function managedEnvironment(lease: ManagedWorktreeLease): NodeJS.ProcessEnv {
	const environment: NodeJS.ProcessEnv = {
		...process.env,
		TMPDIR: lease.agentScratchPath,
		TMP: lease.agentScratchPath,
		TEMP: lease.agentScratchPath,
		GIT_OPTIONAL_LOCKS: "0",
		...(lease.workMap
			? {
					GOLDBAND_WORKTREE_LEASE_ID: lease.id,
					GOLDBAND_WORK_ID: lease.workMap.workId,
					GOLDBAND_TICKET_ID: lease.workMap.ticketId,
				}
			: {}),
	};
	for (const key of GIT_WRITE_ENV) delete environment[key];
	return environment;
}

function managedVerificationEnvironment(
	lease: ManagedWorktreeLease,
): NodeJS.ProcessEnv {
	return {
		PATH: process.env.PATH ?? "/usr/bin:/bin",
		HOME: lease.agentScratchPath,
		TMPDIR: lease.agentScratchPath,
		TMP: lease.agentScratchPath,
		TEMP: lease.agentScratchPath,
		CI: "1",
		NO_COLOR: "1",
		GIT_OPTIONAL_LOCKS: "0",
		...(lease.workMap
			? {
					GOLDBAND_WORKTREE_LEASE_ID: lease.id,
					GOLDBAND_WORK_ID: lease.workMap.workId,
					GOLDBAND_TICKET_ID: lease.workMap.ticketId,
				}
			: {}),
	};
}

function requireExecutable(command: string): string {
	const resolved = Bun.which(command);
	if (!resolved) {
		throw new Error(
			`hard enforcement unavailable: required executable not found: ${command}`,
		);
	}
	return resolved;
}

function schemeString(value: string): string {
	return JSON.stringify(value);
}

export function defaultManagedShell(): string {
	const configured = process.env.SHELL;
	if (configured && path.isAbsolute(configured) && fs.existsSync(configured)) {
		return configured;
	}
	return os.platform() === "win32" ? "cmd.exe" : "/bin/sh";
}
