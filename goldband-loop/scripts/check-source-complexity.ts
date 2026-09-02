#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Diagnostic = {
	category?: string;
	message?: string;
	location?: { path?: string };
};

export type ComplexityBaseline = {
	schemaVersion: 1;
	files: Record<string, Record<string, number[]>>;
};

const ROOT = join(import.meta.dir, "..");
const REPOSITORY_ROOT = join(ROOT, "..");
const BASELINE_FILE = join(ROOT, "config", "source-complexity-baseline.json");
const BASELINE_REPOSITORY_PATH =
	"goldband-loop/config/source-complexity-baseline.json";
const RULES = [
	"complexity/noExcessiveLinesPerFunction",
	"complexity/noExcessiveCognitiveComplexity",
	"complexity/useMaxParams",
];

export function summarizeDiagnostics(
	diagnostics: Diagnostic[],
): ComplexityBaseline {
	const files: ComplexityBaseline["files"] = {};
	for (const diagnostic of diagnostics) {
		const path = diagnostic.location?.path;
		const category = diagnostic.category;
		const value = Number(diagnostic.message?.match(/\d+/)?.[0]);
		if (
			!path ||
			!category ||
			!RULES.some((rule) => category.endsWith(rule)) ||
			!Number.isFinite(value)
		)
			continue;
		const metrics = files[path] ?? {};
		const values = metrics[category] ?? [];
		values.push(value);
		metrics[category] = values;
		files[path] = metrics;
	}
	return normalizeBaseline({ schemaVersion: 1, files });
}

export function worsenedMetrics(
	expected: ComplexityBaseline,
	actual: ComplexityBaseline,
): string[] {
	const failures: string[] = [];
	for (const [path, rules] of Object.entries(actual.files)) {
		for (const [category, values] of Object.entries(rules)) {
			const allowed = expected.files[path]?.[category] ?? [];
			if (ruleDebtIncreased(values, allowed)) {
				failures.push(
					`${path} ${category}: ${values.join(",")} > ${allowed.join(",") || "none"}`,
				);
			}
		}
	}
	return failures;
}

export function baselineTransitionFailures(
	predecessor: ComplexityBaseline,
	candidate: ComplexityBaseline,
	actual: ComplexityBaseline,
): string[] {
	return [
		...worsenedMetrics(predecessor, candidate).map(
			(failure) => `candidate baseline exceeds predecessor: ${failure}`,
		),
		...worsenedMetrics(candidate, actual).map(
			(failure) => `source exceeds candidate baseline: ${failure}`,
		),
	];
}

function ruleDebtIncreased(actual: number[], allowed: number[]): boolean {
	return actual.some((value, index) => value > (allowed[index] ?? 0));
}

function runBiome(): ComplexityBaseline {
	const executable = join(
		ROOT,
		"node_modules",
		".bin",
		process.platform === "win32" ? "biome.cmd" : "biome",
	);
	const args = [
		"lint",
		"--config-path",
		"biome.json",
		"--max-diagnostics=none",
		"--reporter=json",
		...RULES.flatMap((rule) => [`--only=${rule}`]),
		".",
	];
	const result = spawnSync(executable, args, {
		cwd: ROOT,
		encoding: "utf8",
		maxBuffer: 16 * 1024 * 1024,
	});
	if (result.status !== 0) {
		throw new Error(
			`Biome complexity scan failed:\n${result.stderr || result.stdout}`,
		);
	}
	const report = JSON.parse(result.stdout) as { diagnostics?: Diagnostic[] };
	return summarizeDiagnostics(report.diagnostics ?? []);
}

function readBaseline(): ComplexityBaseline {
	return parseBaseline(readFileSync(BASELINE_FILE, "utf8"));
}

function parseBaseline(source: string): ComplexityBaseline {
	const parsed = JSON.parse(source) as ComplexityBaseline;
	if (
		parsed.schemaVersion !== 1 ||
		!parsed.files ||
		Array.isArray(parsed.files)
	) {
		throw new Error("source complexity baseline has an unsupported schema");
	}
	return normalizeBaseline(parsed);
}

function predecessorBaseline(candidate: ComplexityBaseline): ComplexityBaseline | undefined {
	const predecessor = predecessorRef(candidate);
	if (!predecessor) return undefined;
	if (!gitCommitExists(predecessor.ref)) {
		if (predecessor.required) {
			throw new Error(`required complexity predecessor is unavailable: ${predecessor.ref}`);
		}
		return undefined;
	}
	const result = spawnSync(
		"git",
		["show", `${predecessor.ref}:${BASELINE_REPOSITORY_PATH}`],
		{ cwd: REPOSITORY_ROOT, encoding: "utf8" },
	);
	if (result.status === 0) return parseBaseline(result.stdout);
	if (result.status === 128 && /does not exist|not in/.test(result.stderr)) {
		return undefined;
	}
	throw new Error(`cannot read predecessor complexity baseline at ${predecessor.ref}: ${result.stderr}`);
}

function predecessorRef(
	candidate: ComplexityBaseline,
): { ref: string; required: boolean } | undefined {
	const pushBase = process.env.GOLDBAND_COMPLEXITY_BASE_REF;
	if (pushBase && !/^0+$/.test(pushBase)) return { ref: pushBase, required: true };
	const mergeRequestBase = process.env.CI_MERGE_REQUEST_DIFF_BASE_SHA;
	if (mergeRequestBase) return { ref: mergeRequestBase, required: true };
	const githubBase = process.env.GITHUB_BASE_REF;
	if (githubBase) return { ref: githubMergeBase(githubBase), required: true };
	const head = baselineAtRef("HEAD");
	return localPredecessorAuthority(candidate, head, baselineLastChange());
}

function gitCommitExists(ref: string): boolean {
	return spawnSync("git", ["cat-file", "-e", `${ref}^{commit}`], {
		cwd: REPOSITORY_ROOT,
		stdio: "ignore",
	}).status === 0;
}

export function localPredecessorAuthority(
	candidate: ComplexityBaseline,
	head: ComplexityBaseline | undefined,
	lastBaselineChange: string | undefined,
): { ref: string; required: boolean } {
	if (!head) return { ref: "HEAD", required: false };
	if (JSON.stringify(head) !== JSON.stringify(candidate)) {
		return { ref: "HEAD", required: true };
	}
	return {
		ref: lastBaselineChange ? `${lastBaselineChange}^` : "HEAD^",
		required: true,
	};
}

function baselineLastChange(): string | undefined {
	const result = spawnSync(
		"git",
		["log", "-n", "1", "--format=%H", "--", BASELINE_REPOSITORY_PATH],
		{ cwd: REPOSITORY_ROOT, encoding: "utf8" },
	);
	if (result.status !== 0) throw new Error(`cannot resolve baseline history: ${result.stderr}`);
	return result.stdout.trim() || undefined;
}

function githubMergeBase(base: string): string {
	for (const reference of [`origin/${base}`, `refs/remotes/origin/${base}`, base]) {
		const result = spawnSync("git", ["merge-base", "HEAD", reference], {
			cwd: REPOSITORY_ROOT,
			encoding: "utf8",
		});
		if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
	}
	throw new Error(`cannot resolve GitHub merge-base for ${base}; fetch authoritative history before source checks`);
}

function baselineAtRef(ref: string): ComplexityBaseline | undefined {
	const result = spawnSync(
		"git",
		["show", `${ref}:${BASELINE_REPOSITORY_PATH}`],
		{ cwd: REPOSITORY_ROOT, encoding: "utf8" },
	);
	return result.status === 0 ? parseBaseline(result.stdout) : undefined;
}

function normalizeBaseline(value: ComplexityBaseline): ComplexityBaseline {
	const files: ComplexityBaseline["files"] = {};
	for (const path of Object.keys(value.files).sort()) {
		const rules: Record<string, number[]> = {};
		for (const category of Object.keys(value.files[path] ?? {}).sort()) {
			rules[category] = [...value.files[path]![category]!].sort(
				(left, right) => right - left,
			);
		}
		files[path] = rules;
	}
	return { schemaVersion: 1, files };
}

function writeBaseline(value: ComplexityBaseline): void {
	const temporary = `${BASELINE_FILE}.tmp.${process.pid}`;
	writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
		flag: "wx",
	});
	renameSync(temporary, BASELINE_FILE);
}

function main(): void {
	const update = process.argv.slice(2).includes("--update");
	const actual = runBiome();
	const expected = readBaseline();
	const predecessor = predecessorBaseline(expected);
	const transitionFailures = predecessor
		? baselineTransitionFailures(predecessor, expected, actual)
		: worsenedMetrics(expected, actual);
	if (transitionFailures.length > 0) {
		throw new Error(
			`source complexity debt increased:\n${transitionFailures.join("\n")}`,
		);
	}
	if (update) {
		writeBaseline(actual);
		console.log(
			`updated source complexity baseline (${Object.keys(actual.files).length} files)`,
		);
		return;
	}
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(
			"source complexity debt decreased; run bun run lint:complexity:update and review the baseline reduction",
		);
	}
	console.log(
		`ok - source complexity baseline is monotonic (${Object.keys(actual.files).length} files)`,
	);
}

if (import.meta.main) main();
