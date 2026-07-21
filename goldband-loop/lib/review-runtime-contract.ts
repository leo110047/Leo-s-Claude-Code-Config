export const REVIEW_RUNTIME_TASK_HEADER = "GOLDBAND_RUNTIME_TASK=review/code";
export const REVIEW_EVIDENCE_DURABILITY_ENV =
	"GOLDBAND_REVIEW_EVIDENCE_DURABILITY";
export const REVIEW_EVIDENCE_DURABILITY_EPHEMERAL = "ephemeral";
export const REVIEW_NON_INTERACTIVE_COMMAND_POLICY =
	"Non-interactive review: never request command approval or use require_escalated. If a command cannot run inside the read-only sandbox, do not retry it outside the sandbox; record that verification as unavailable and continue the review from available read-only evidence.";

export const REVIEW_SCOPE_FLAGS = [
	"--staged",
	"--worktree",
	"--base",
	"--diff-file",
	"--include-untracked",
] as const;

export type ReviewScopeFlag = (typeof REVIEW_SCOPE_FLAGS)[number];

type ReviewScopeOptions = {
	staged?: boolean;
	worktree?: boolean;
	base?: string;
	diffFile?: string;
	includeUntracked?: boolean;
};

export function assertValidReviewScopeFlags(flags: ReviewScopeFlag[]): void {
	const selected = new Set(flags);
	const primary = REVIEW_SCOPE_FLAGS.filter(
		(flag) => flag !== "--include-untracked" && selected.has(flag),
	);
	const allowedBaseWorktree =
		primary.length === 2 &&
		primary.includes("--base") &&
		primary.includes("--worktree");
	const diffFileWithUntracked =
		selected.has("--diff-file") && selected.has("--include-untracked");
	if (primary.length > 1 && !allowedBaseWorktree || diffFileWithUntracked) {
		throw new Error(
			`conflicting review scope flags: ${REVIEW_SCOPE_FLAGS.filter((flag) => selected.has(flag)).join(", ")}; use one scope, with --base --worktree as the only combined scope`,
		);
	}
}

export function assertValidReviewScopeOptions(options: ReviewScopeOptions): void {
	const flags: ReviewScopeFlag[] = [];
	if (options.staged) flags.push("--staged");
	if (options.worktree) flags.push("--worktree");
	if (options.base !== undefined) flags.push("--base");
	if (options.diffFile !== undefined) flags.push("--diff-file");
	if (options.includeUntracked) flags.push("--include-untracked");
	assertValidReviewScopeFlags(flags);
}
