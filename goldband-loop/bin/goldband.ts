#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
import {
	assertValidReviewScopeFlags,
	assertReviewNotNested,
	INDEPENDENT_REVIEWER_ERROR,
	REVIEW_ACTIVE_ENV,
	REVIEW_SCOPE_FLAGS,
	REVIEW_EVIDENCE_DURABILITY_ENV,
	REVIEW_EVIDENCE_DURABILITY_EPHEMERAL,
	type ReviewScopeFlag,
} from "../lib/review-runtime-contract";
import {
	acquireReviewExecutionLease,
	releaseReviewExecutionLease,
} from "../lib/review-execution-lease";
import { resolveGoldbandStateRoot } from "../lib/state-root";

type ReviewHost = "claude" | "codex";

type TrustedBrowserRuntime = {
	browserExecutable: string;
	browserServerScript: string;
	bunExecutable: string;
};

type TrustedRulesRuntime = {
	rulesResolverScript: string;
	rulesDirectory: string;
};

type ReviewRuntimeResolutionOptions = {
	entryFile?: string;
	env?: NodeJS.ProcessEnv;
};

type ReviewProcessEnvironment = {
	env: NodeJS.ProcessEnv;
	evidenceRoot: string;
	coordinationRoot: string;
	durability: "durable" | "ephemeral";
};

type ReviewProcessEnvironmentOptions = {
	home?: string;
	coordinationRoot?: string;
	createTemporaryRoot?: () => string;
	probeStateRoot?: (root: string) => void;
};

const TRUSTED_CODEX_EXECUTABLE_ENV = "GOLDBAND_TRUSTED_CODEX_EXECUTABLE";
const TRUSTED_BROWSER_EXECUTABLE_ENV = "GOLDBAND_TRUSTED_BROWSER_EXECUTABLE";

function printUsage(stream: Pick<Console, "log">): void {
	stream.log("Usage:");
	stream.log(
		"  goldband review code --host <claude|codex> [--staged|--worktree|--base <ref>|--diff-file <file>] [--include-untracked] [--review-host-timeout-seconds <60-1800>] [--review-pass-timeout-seconds <60-1800>]",
	);
	stream.log(
		"  goldband browser session --host <claude|codex> [command] [args...]",
	);
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

export function buildReviewRuntimeArgs(args: string[]): string[] {
	let host: ReviewHost | undefined;
	const forwarded: string[] = [];
	let hasScope = false;
	const scopeFlags: ReviewScopeFlag[] = [];

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--host") {
			const value = args[index + 1];
			if (value !== "claude" && value !== "codex") {
				throw new Error("review code requires --host claude or --host codex");
			}
			if (host) throw new Error("review code accepts --host only once");
			host = value;
			index += 1;
			continue;
		}
		if (arg === "--mode") {
			throw new Error(
				"review code always uses real mode; --mode is not accepted",
			);
		}
		if (arg === "--loop") {
			throw new Error(
				"review code is single-pass; --loop is disabled to prevent repeated full-diff model calls",
			);
		}
		if (arg === "--specialists") {
			const value = args[index + 1];
			if (!value) throw new Error("--specialists requires a value");
			if (value !== "off") {
				throw new Error(`${INDEPENDENT_REVIEWER_ERROR}; remove --specialists`);
			}
			index += 1;
			continue;
		}
		if (REVIEW_SCOPE_FLAGS.includes(arg as ReviewScopeFlag)) {
			scopeFlags.push(arg as ReviewScopeFlag);
		}
		if (["--staged", "--worktree", "--base", "--diff-file"].includes(arg)) {
			hasScope = true;
		}
		forwarded.push(arg);
	}

	if (!host)
		throw new Error("review code requires --host claude or --host codex");
	assertValidReviewScopeFlags(scopeFlags);
	if (!hasScope) forwarded.unshift("--worktree");

	return ["review", "code", "--mode", "real", "--host", host, ...forwarded];
}

function resolveWorkflowRuntimeFile(
	options: ReviewRuntimeResolutionOptions = {},
): string {
	const env = options.env ?? process.env;
	const entryFile = options.entryFile ?? fileURLToPath(import.meta.url);
	const entryRoot = resolve(dirname(realpathSync(entryFile)), "..");
	const trustedRuntime = existsSync(join(entryRoot, "trusted-runtime.json"));
	const candidateRoots = trustedRuntime
		? [entryRoot]
		: [env.GOLDBAND_LOOP_DIR, env.GOLDBAND_ROOT, entryRoot];
	const roots = candidateRoots
		.filter((value): value is string => Boolean(value))
		.flatMap((root) => [root, installedSourceRoot(root)])
		.filter((value): value is string => Boolean(value));

	for (const root of [
		...new Set(roots.map((candidate) => resolve(candidate))),
	]) {
		const runtimeFile = join(root, "workflows", "run.ts");
		if (existsSync(runtimeFile)) return runtimeFile;
	}

	throw new Error(
		"workflow runtime unavailable: expected workflows/run.ts in the active Goldband source or its .installed-source",
	);
}

export const resolveReviewRuntimeFile = resolveWorkflowRuntimeFile;

function installedSourceRoot(runtimeRoot: string): string | undefined {
	const marker = join(runtimeRoot, ".installed-source");
	if (!existsSync(marker)) return undefined;
	const source = readFileSync(marker, "utf8").trim();
	return source || undefined;
}

function reviewCode(args: string[]): number {
	assertReviewNotNested(process.env);
	const runtimeFile = resolveWorkflowRuntimeFile();
	const runtimeArgs = buildReviewRuntimeArgs(args);
	const reviewEnvironment = prepareReviewProcessEnvironment(process.env);
	const trustedCodexExecutable = resolveTrustedCodexExecutable();
	if (trustedCodexExecutable) resolveTrustedRulesRuntime();
	if (trustedCodexExecutable) {
		reviewEnvironment.env[TRUSTED_CODEX_EXECUTABLE_ENV] =
			trustedCodexExecutable;
	}
	if (reviewEnvironment.durability === "ephemeral") {
		console.error(
			`Goldband review: durable state root is not writable in this sandbox; evidence will use sandbox-safe temporary root ${reviewEnvironment.evidenceRoot}.`,
		);
	}
	const lease = acquireReviewExecutionLease(
		reviewEnvironment.coordinationRoot,
		process.cwd(),
		runtimeArgs,
	);
	reviewEnvironment.env[REVIEW_ACTIVE_ENV] = lease.token;
	try {
		const result = spawnSync(process.execPath, [runtimeFile, ...runtimeArgs], {
			cwd: process.cwd(),
			env: reviewEnvironment.env,
			stdio: "inherit",
		});
		if (result.error) throw result.error;
		if (result.status === null) {
			throw new Error(
				`review runtime terminated without an exit status (${result.signal ?? "unknown signal"})`,
			);
		}
		return result.status;
	} finally {
		releaseReviewExecutionLease(lease);
	}
}

function browserSession(args: string[]): number {
	const hostFlag = args[0];
	const host = args[1];
	if (hostFlag !== "--host" || (host !== "claude" && host !== "codex")) {
		throw new Error(
			"browser session requires --host claude or --host codex before the browser command",
		);
	}
	const command = args[2] || "status";
	const commandArgs = args.slice(3);
	const runtimeFile = resolveWorkflowRuntimeFile();
	const runtimeEnvironment = prepareReviewProcessEnvironment(process.env);
	const trustedBrowser = resolveTrustedBrowserRuntime();
	if (trustedBrowser) resolveTrustedRulesRuntime();
	if (host === "codex" && !trustedBrowser) {
		throw new Error(
			"trusted Codex browser runtime is not installed; rerun ./install.sh workflow-codex",
		);
	}
	if (trustedBrowser) {
		runtimeEnvironment.env[TRUSTED_BROWSER_EXECUTABLE_ENV] =
			trustedBrowser.browserExecutable;
		runtimeEnvironment.env.BROWSE_SERVER_SCRIPT =
			trustedBrowser.browserServerScript;
		runtimeEnvironment.env.BROWSE_BUN_EXECUTABLE = trustedBrowser.bunExecutable;
	}
	if (runtimeEnvironment.durability === "ephemeral") {
		console.error(
			`Goldband browser: durable state root is not writable in this sandbox; evidence will use sandbox-safe temporary root ${runtimeEnvironment.evidenceRoot}.`,
		);
	}

	const inputRoot = mkdtempSync(join(tmpdir(), "goldband-browser-input-"));
	const inputFile = join(inputRoot, "request.json");
	writeFileSync(
		inputFile,
		`${JSON.stringify({ command, args: commandArgs })}\n`,
		{ mode: 0o600 },
	);
	try {
		const result = spawnSync(
			process.execPath,
			[
				runtimeFile,
				"browser",
				"session",
				"--mode",
				"real",
				"--host",
				host,
				"--input",
				inputFile,
			],
			{
				cwd: process.cwd(),
				env: runtimeEnvironment.env,
				stdio: "inherit",
			},
		);
		if (result.error) throw result.error;
		if (result.status === null) {
			throw new Error(
				`browser runtime terminated without an exit status (${result.signal ?? "unknown signal"})`,
			);
		}
		return result.status;
	} finally {
		rmSync(inputRoot, { recursive: true, force: true });
	}
}

export function prepareReviewProcessEnvironment(
	env: NodeJS.ProcessEnv,
	options: ReviewProcessEnvironmentOptions = {},
): ReviewProcessEnvironment {
	const cleanEnv = { ...env };
	delete cleanEnv[REVIEW_EVIDENCE_DURABILITY_ENV];
	delete cleanEnv[TRUSTED_CODEX_EXECUTABLE_ENV];
	delete cleanEnv[TRUSTED_BROWSER_EXECUTABLE_ENV];
	delete cleanEnv.BROWSE_SERVER_SCRIPT;
	delete cleanEnv.BROWSE_BUN_EXECUTABLE;
	const explicitRoot = hasExplicitStateRoot(env);
	const evidenceRoot = resolveGoldbandStateRoot(
		undefined,
		env,
		options.home ?? homedir(),
	);
	const probe = options.probeStateRoot ?? probeWritableStateRoot;
	try {
		probe(evidenceRoot);
		return {
			env: cleanEnv,
			evidenceRoot,
			coordinationRoot: prepareTemporaryReviewCoordinationRoot(
				options.coordinationRoot ?? defaultReviewCoordinationRoot(options.home),
			),
			durability: "durable",
		};
	} catch (error) {
		if (explicitRoot || !isStateRootPermissionError(error)) throw error;
	}

	const temporaryRoot = options.createTemporaryRoot
		? options.createTemporaryRoot()
		: mkdtempSync(join(tmpdir(), "goldband-review-state-"));
	probe(temporaryRoot);
	const coordinationRoot = prepareTemporaryReviewCoordinationRoot(
		options.coordinationRoot ?? defaultReviewCoordinationRoot(options.home),
	);
	return {
		env: {
			...cleanEnv,
			GOLDBAND_HOME: temporaryRoot,
			[REVIEW_EVIDENCE_DURABILITY_ENV]: REVIEW_EVIDENCE_DURABILITY_EPHEMERAL,
		},
		evidenceRoot: temporaryRoot,
		coordinationRoot,
		durability: "ephemeral",
	};
}

function defaultReviewCoordinationRoot(home = homedir()): string {
	const identity =
		typeof process.getuid === "function"
			? String(process.getuid())
			: createHash("sha256").update(home).digest("hex").slice(0, 12);
	return join(
		realpathSync(tmpdir()),
		`goldband-review-coordination-${identity}`,
	);
}

function prepareTemporaryReviewCoordinationRoot(root: string): string {
	mkdirSync(root, { recursive: true, mode: 0o700 });
	const metadata = lstatSync(root);
	if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
		throw new Error(
			`review coordination root must be a real directory: ${root}`,
		);
	}
	if (
		typeof process.getuid === "function" &&
		metadata.uid !== process.getuid()
	) {
		throw new Error(
			`review coordination root is not owned by the current user: ${root}`,
		);
	}
	chmodSync(root, 0o700);
	probeWritableStateRoot(root);
	return realpathSync(root);
}

export function resolveTrustedCodexExecutable(
	entryFile = fileURLToPath(import.meta.url),
): string | undefined {
	const resolved = readTrustedRuntimeConfig(entryFile);
	if (!resolved) return undefined;
	return requireTrustedExecutable(
		resolved.configFile,
		"codexExecutable",
		resolved.config.codexExecutable,
	);
}

export function resolveTrustedBrowserRuntime(
	entryFile = fileURLToPath(import.meta.url),
): TrustedBrowserRuntime | undefined {
	const resolved = readTrustedRuntimeConfig(entryFile);
	if (!resolved) return undefined;
	return {
		browserExecutable: requireTrustedExecutable(
			resolved.configFile,
			"browserExecutable",
			resolved.config.browserExecutable,
		),
		browserServerScript: requireTrustedFile(
			resolved.configFile,
			"browserServerScript",
			resolved.config.browserServerScript,
		),
		bunExecutable: requireTrustedExecutable(
			resolved.configFile,
			"bunExecutable",
			resolved.config.bunExecutable,
		),
	};
}

export function resolveTrustedRulesRuntime(
	entryFile = fileURLToPath(import.meta.url),
): TrustedRulesRuntime | undefined {
	const resolved = readTrustedRuntimeConfig(entryFile);
	if (!resolved) return undefined;
	return {
		rulesResolverScript: requireTrustedFile(
			resolved.configFile,
			"rulesResolverScript",
			resolved.config.rulesResolverScript,
		),
		rulesDirectory: requireTrustedDirectory(
			resolved.configFile,
			"rulesDirectory",
			resolved.config.rulesDirectory,
		),
	};
}

function readTrustedRuntimeConfig(entryFile: string):
	| {
			configFile: string;
			config: Record<string, unknown>;
	  }
	| undefined {
	const entryRoot = resolve(dirname(realpathSync(entryFile)), "..");
	const configFile = join(entryRoot, "trusted-runtime.json");
	if (!existsSync(configFile)) return undefined;
	const config = JSON.parse(readFileSync(configFile, "utf8")) as Record<
		string,
		unknown
	>;
	if (config.schemaVersion !== 2) {
		throw new Error(`trusted runtime configuration is invalid: ${configFile}`);
	}
	return { configFile, config };
}

function requireTrustedExecutable(
	configFile: string,
	field: string,
	value: unknown,
): string {
	const file = requireTrustedFile(configFile, field, value);
	return realpathSync(file);
}

function requireTrustedFile(
	configFile: string,
	field: string,
	value: unknown,
): string {
	if (typeof value !== "string" || !isAbsolute(value) || !existsSync(value)) {
		throw new Error(
			`trusted runtime configuration field ${field} is invalid: ${configFile}`,
		);
	}
	return realpathSync(value);
}

function requireTrustedDirectory(
	configFile: string,
	field: string,
	value: unknown,
): string {
	const directory = requireTrustedFile(configFile, field, value);
	if (!statSync(directory).isDirectory()) {
		throw new Error(
			`trusted runtime configuration field ${field} is not a directory: ${configFile}`,
		);
	}
	return directory;
}

function hasExplicitStateRoot(env: NodeJS.ProcessEnv): boolean {
	return Boolean(
		env.GOLDBAND_HOME ||
			env.GOLDBAND_STATE_DIR ||
			env.GOLDBAND_STATE_ROOT ||
			(env.CLAUDE_PLUGIN_DATA &&
				env.CLAUDE_PLUGIN_ROOT?.toLowerCase().includes("goldband")),
	);
}

function probeWritableStateRoot(root: string): void {
	mkdirSync(root, { recursive: true });
	const probe = mkdtempSync(join(root, ".review-write-probe-"));
	writeFileSync(join(probe, "probe"), "review evidence write probe\n");
	rmSync(probe, { recursive: true, force: true });
}

function isStateRootPermissionError(error: unknown): boolean {
	if (!error || typeof error !== "object" || !("code" in error)) return false;
	return ["EACCES", "EPERM", "EROFS"].includes(String(error.code));
}

export function main(args = process.argv.slice(2)): number {
	const [scope, action, name, ...rest] = args;
	if (scope === "-h" || scope === "--help" || scope === "help") {
		printUsage(console);
		return 0;
	}
	if (scope === "review") {
		if (action !== "code") usage();
		return reviewCode(
			[name, ...rest].filter((value): value is string => value !== undefined),
		);
	}
	if (scope === "browser") {
		if (action !== "session") usage();
		return browserSession(
			[name, ...rest].filter((value): value is string => value !== undefined),
		);
	}
	if (scope !== "worktree") usage();
	if (action === "create") return create(name, rest);
	if (action === "finish") return finish(name, rest);
	usage();
}

if (import.meta.main) {
	try {
		process.exitCode = main();
	} catch (error) {
		console.error(
			`goldband: ${error instanceof Error ? error.message : String(error)}`,
		);
		process.exitCode = 1;
	}
}
