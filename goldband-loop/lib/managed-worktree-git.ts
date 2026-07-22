import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type CommandResult = SpawnSyncReturns<string>;

export interface GitExecutionContext {
	executable: string;
	environment: NodeJS.ProcessEnv;
	configArgs: string[];
}

export interface GitIdentity {
	name: string;
	email: string;
}

export function resolveTrustedGitExecutable(): string {
	const candidates = ["/usr/bin/git", Bun.which("git")].filter(
		(candidate): candidate is string => Boolean(candidate),
	);
	for (const candidate of candidates) {
		try {
			fs.accessSync(candidate, fs.constants.X_OK);
			return fs.realpathSync(candidate);
		} catch {
			// Continue to the next fixed candidate.
		}
	}
	throw new Error("trusted Git executable is unavailable");
}

export function readGitIdentity(executable: string, cwd: string): GitIdentity {
	const environment = discoveryEnvironment(executable);
	const name = rawGitOutput(
		executable,
		["-c", "core.fsmonitor=false", "config", "--get", "user.name"],
		cwd,
		environment,
	);
	const email = rawGitOutput(
		executable,
		["-c", "core.fsmonitor=false", "config", "--get", "user.email"],
		cwd,
		environment,
	);
	if (!name || !email || /[\0\r\n]/.test(name) || /[\0\r\n]/.test(email)) {
		throw new Error(
			"managed worktree requires a valid Git user.name and user.email",
		);
	}
	return { name, email };
}

export function createGitExecutionContext(options: {
	executable: string;
	scratchPath: string;
	hookRoot?: string;
	identity?: GitIdentity;
}): GitExecutionContext {
	const brokerHome = path.join(options.scratchPath, "broker-home");
	const brokerConfig = path.join(brokerHome, ".config");
	fs.mkdirSync(brokerConfig, { recursive: true, mode: 0o700 });
	if (process.platform !== "win32") {
		fs.chmodSync(brokerHome, 0o700);
		fs.chmodSync(brokerConfig, 0o700);
	}
	const environment: NodeJS.ProcessEnv = {
		HOME: brokerHome,
		XDG_CONFIG_HOME: brokerConfig,
		TMPDIR: options.scratchPath,
		TMP: options.scratchPath,
		TEMP: options.scratchPath,
		PATH: trustedPath(options.executable),
		LC_ALL: "C",
		LANG: "C",
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_TERMINAL_PROMPT: "0",
	};
	if (options.identity) {
		environment.GIT_AUTHOR_NAME = options.identity.name;
		environment.GIT_AUTHOR_EMAIL = options.identity.email;
		environment.GIT_COMMITTER_NAME = options.identity.name;
		environment.GIT_COMMITTER_EMAIL = options.identity.email;
	}
	return {
		executable: options.executable,
		environment,
		configArgs: [
			"-c",
			`core.hooksPath=${options.hookRoot ?? ""}`,
			"-c",
			"core.fsmonitor=false",
		],
	};
}

export function withGitEnvironment(
	context: GitExecutionContext,
	overrides: NodeJS.ProcessEnv,
): GitExecutionContext {
	return {
		...context,
		environment: { ...context.environment, ...overrides },
	};
}

export function canonicalRepoRoot(
	candidate: string,
	context: GitExecutionContext,
): string {
	const root = gitOutput(
		["rev-parse", "--show-toplevel"],
		path.resolve(candidate),
		context,
	);
	return fs.realpathSync(root);
}

export function canonicalGitPath(cwd: string, gitPath: string): string {
	return fs.realpathSync(path.resolve(cwd, gitPath));
}

export function gitOutput(
	args: string[],
	cwd: string,
	context: GitExecutionContext,
): string {
	const result = gitRun(args, cwd, context);
	if (result.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${cleanError(result)}`);
	}
	return result.stdout.trim();
}

export function gitBuffer(
	args: string[],
	cwd: string,
	context: GitExecutionContext,
): Buffer {
	const result = spawnSync(
		context.executable,
		[...context.configArgs, ...args],
		{
			cwd,
			env: context.environment,
			encoding: "buffer",
		},
	);
	if (result.status !== 0) {
		throw new Error(
			`git ${args.join(" ")} failed: ${result.stderr.toString("utf8")}`,
		);
	}
	return result.stdout;
}

export function gitOk(
	args: string[],
	cwd: string,
	context: GitExecutionContext,
): void {
	const result = gitRun(args, cwd, context);
	if (result.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${cleanError(result)}`);
	}
}

export function gitRun(
	args: string[],
	cwd: string,
	context: GitExecutionContext,
	input?: string,
): CommandResult {
	return spawnSync(context.executable, [...context.configArgs, ...args], {
		cwd,
		env: context.environment,
		encoding: "utf8",
		input,
	});
}

export function cleanError(result: CommandResult): string {
	return [result.stderr, result.stdout, result.error?.message]
		.filter(Boolean)
		.join("\n")
		.trim();
}

function trustedPath(executable: string): string {
	return [path.dirname(executable), "/usr/bin", "/bin", "/usr/sbin", "/sbin"]
		.filter((entry, index, entries) => entries.indexOf(entry) === index)
		.join(path.delimiter);
}

function discoveryEnvironment(executable: string): NodeJS.ProcessEnv {
	const home = process.env.HOME ?? os.homedir();
	const environment: NodeJS.ProcessEnv = {
		HOME: home,
		PATH: trustedPath(executable),
		LC_ALL: "C",
		LANG: "C",
		GIT_TERMINAL_PROMPT: "0",
	};
	if (process.env.XDG_CONFIG_HOME) {
		environment.XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME;
	}
	for (const key of ["SystemRoot", "WINDIR", "ComSpec"] as const) {
		if (process.env[key]) environment[key] = process.env[key];
	}
	return environment;
}

function rawGitOutput(
	executable: string,
	args: string[],
	cwd: string,
	environment: NodeJS.ProcessEnv,
): string {
	const result = spawnSync(executable, args, {
		cwd,
		env: environment,
		encoding: "utf8",
	});
	if (result.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${cleanError(result)}`);
	}
	return result.stdout.trim();
}
