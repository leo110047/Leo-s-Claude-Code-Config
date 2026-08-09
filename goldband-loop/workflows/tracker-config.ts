import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveGoldbandStateRoot } from "../lib/state-root";
import type {
	TrackerCommandRunner,
	TrackerConfigurationReadback,
	TrackerProvider,
} from "./tracker-adapters/types";

type TrackerMode = "off" | TrackerProvider;
export type TrackerConfigurationV1 = {
	schemaVersion: 1;
	mode: TrackerMode;
	repository: string | null;
	defaultLabels: string[];
	dependencyCapability: "native" | "body-links";
};

export const defaultTrackerConfiguration: TrackerConfigurationV1 = {
	schemaVersion: 1,
	mode: "off",
	repository: null,
	defaultLabels: [],
	dependencyCapability: "body-links",
};

export function parseTrackerConfiguration(value: unknown): TrackerConfigurationV1 {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("tracker configuration must be an object");
	const item = value as Record<string, unknown>;
	const allowed = new Set(["schemaVersion", "mode", "repository", "defaultLabels", "dependencyCapability"]);
	if (Object.keys(item).length !== allowed.size || Object.keys(item).some((key) => !allowed.has(key))) throw new Error("invalid tracker configuration fields");
	if (item.schemaVersion !== 1) throw new Error("unsupported tracker configuration schema");
	if (item.mode !== "off" && item.mode !== "github" && item.mode !== "gitlab") throw new Error("invalid tracker mode");
	if (item.dependencyCapability !== "native" && item.dependencyCapability !== "body-links") throw new Error("invalid dependency capability");
	if (!Array.isArray(item.defaultLabels) || item.defaultLabels.some((label) => typeof label !== "string" || !/^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,63}$/.test(label)) || new Set(item.defaultLabels).size !== item.defaultLabels.length) throw new Error("invalid default labels");
	const repository = item.repository;
	if (item.mode === "off") {
		if (repository !== null) throw new Error("off tracker mode must not name a repository");
	} else if (typeof repository !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
		throw new Error("tracker repository must be owner/name");
	}
	return {
		schemaVersion: 1,
		mode: item.mode,
		repository: repository as string | null,
		defaultLabels: [...(item.defaultLabels as string[])],
		dependencyCapability: item.dependencyCapability,
	};
}

export class TrackerConfigurationStore {
	readonly path: string;

	constructor(goldbandHome?: string) {
		const stateRoot = secureTrackerStateDirectory(resolveGoldbandStateRoot(goldbandHome));
		this.path = join(secureTrackerStateDirectory(join(stateRoot, "tracker")), "config.json");
	}

	read(): TrackerConfigurationV1 {
		if (!existsSync(this.path)) return structuredClone(defaultTrackerConfiguration);
		if (lstatSync(this.path).isSymbolicLink()) throw new Error("tracker configuration must not be a symbolic link");
		return parseTrackerConfiguration(JSON.parse(readFileSync(this.path, "utf8")));
	}

	write(configuration: TrackerConfigurationV1): TrackerConfigurationV1 {
		const parsed = parseTrackerConfiguration(configuration);
		mkdirSync(join(this.path, ".."), { recursive: true, mode: 0o700 });
		const temporary = `${this.path}.tmp-${process.pid}-${Date.now()}`;
		writeFileSync(temporary, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600, flag: "wx" });
		renameSync(temporary, this.path);
		return parsed;
	}
}

export function secureTrackerStateDirectory(path: string): string {
	if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 });
	const metadata = lstatSync(path);
	if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error(`tracker state directory must be a real directory: ${path}`);
	return path;
}

export function inspectTrackerConfiguration(
	configuration: TrackerConfigurationV1,
	runner: TrackerCommandRunner = runTrackerCommand,
): TrackerConfigurationReadback | { provider: "off"; blockedReason: "tracker mode is off" } {
	const parsed = parseTrackerConfiguration(configuration);
	if (parsed.mode === "off") return { provider: "off", blockedReason: "tracker mode is off" };
	const active = {
		...parsed,
		mode: parsed.mode,
		repository: parsed.repository as string,
	};
	const command = parsed.mode === "github" ? "gh" : "glab";
	const version = runner(command, ["--version"]);
	if (version.status !== 0) return blocked(active, false, false, false, `${command} CLI unavailable`);
	const authArgs = parsed.mode === "github" ? ["auth", "status"] : ["auth", "status"];
	const auth = runner(command, authArgs);
	if (auth.status !== 0) return blocked(active, true, false, false, `${command} authentication unavailable`);
	const repoArgs = parsed.mode === "github"
		? ["repo", "view", parsed.repository as string, "--json", "nameWithOwner"]
		: ["repo", "view", parsed.repository as string, "--output", "json"];
	const repository = runner(command, repoArgs);
	if (repository.status !== 0) return blocked(active, true, true, false, "tracker repository is not accessible");
	return {
		provider: parsed.mode,
		repository: parsed.repository as string,
		cliAvailable: true,
		authenticated: true,
		repositoryAccessible: true,
		dependencyCapability: parsed.dependencyCapability,
	};
}

export function runTrackerCommand(command: string, args: readonly string[]) {
	const result = spawnSync(command, [...args], { encoding: "utf8", env: process.env });
	return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function blocked(
	configuration: TrackerConfigurationV1 & { mode: TrackerProvider; repository: string },
	cliAvailable: boolean,
	authenticated: boolean,
	repositoryAccessible: boolean,
	blockedReason: string,
): TrackerConfigurationReadback {
	return {
		provider: configuration.mode,
		repository: configuration.repository,
		cliAvailable,
		authenticated,
		repositoryAccessible,
		dependencyCapability: configuration.dependencyCapability,
		blockedReason,
	};
}
