---
name: goldband-review
preamble-tier: 0
version: 1.0.0
description: |
  Read-only pre-landing code review. Finds concrete, reachable defects in the
  current diff and suppresses speculative findings. Use for PR review, code
  review, pre-landing review, or checking a diff. (goldband)
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
triggers:
  - review this pr
  - code review
  - check my diff
  - pre-landing review
---
<!-- AUTO-GENERATED from SKILL.md.tmpl — do not edit directly -->
<!-- Regenerate: bun run gen:skill-docs -->

## Runtime root

```bash
. "$HOME/.claude/skills/goldband/bin/goldband-env" || exit $?
GOLDBAND_RULES_DIR="${GOLDBAND_RULES_DIR:-}"
for _RULES_DIR in "${_ROOT:-}/rules" "$HOME/.claude/rules" "$HOME/.codex/rules"; do
  if [ -z "$GOLDBAND_RULES_DIR" ] && [ -f "$_RULES_DIR/semantic-review-criteria.md" ]; then
    GOLDBAND_RULES_DIR="$_RULES_DIR"
  fi
done
```

## Step 0: Detect platform and base branch

First, detect the git hosting platform from the remote URL:

```bash
git remote get-url origin 2>/dev/null
```

- If the URL contains "github.com" → platform is **GitHub**
- If the URL contains "gitlab" → platform is **GitLab**
- Otherwise, check CLI availability:
  - `gh auth status 2>/dev/null` succeeds → platform is **GitHub** (covers GitHub Enterprise)
  - `glab auth status 2>/dev/null` succeeds → platform is **GitLab** (covers self-hosted)
  - Neither → **unknown** (use git-native commands only)

Determine which branch this PR/MR targets, or the repo's default branch if no
PR/MR exists. Use the result as "the base branch" in all subsequent steps.

**If GitHub:**
1. `gh pr view --json baseRefName -q .baseRefName` — if succeeds, use it
2. `gh repo view --json defaultBranchRef -q .defaultBranchRef.name` — if succeeds, use it

**If GitLab:**
1. `glab mr view -F json 2>/dev/null` and extract the `target_branch` field — if succeeds, use it
2. `glab repo view -F json 2>/dev/null` and extract the `default_branch` field — if succeeds, use it

**Git-native fallback (if unknown platform, or CLI commands fail):**
1. `git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||'`
2. If that fails: `git rev-parse --verify origin/main 2>/dev/null` → use `main`
3. If that fails: `git rev-parse --verify origin/master 2>/dev/null` → use `master`

If all fail, fall back to `main`.

Print the detected base branch name. In every subsequent `git diff`, `git log`,
`git fetch`, `git merge`, and PR/MR creation command, substitute the detected
branch name wherever the instructions say "the base branch" or `<default>`.

---

# Read-Only Pre-Landing Code Review

Review the current branch against the detected base branch. Find real defects
that tests may miss. Do not edit files, apply patches, commit, push, or invoke
repair workflows.

## Preferred runtime

Use the programmatic runtime when structured evidence or repeatable execution is
needed:

```bash
bun run workflows/run.ts review code --mode mock --base "origin/<detected-base-branch>" --worktree
```

Real LLM execution requires explicit authorization and an explicit host:

```bash
bun run workflows/run.ts review code --mode real --host claude --base "origin/<detected-base-branch>" --worktree
bun run workflows/run.ts review code --mode real --host codex --base "origin/<detected-base-branch>" --worktree
```

Specialists are optional:

- `--specialists auto` is the default. It dispatches at most two specialists,
  and only when the diff contains a matching security, migration, performance,
  or host-contract risk signal.
- `--specialists off` runs only the core reviewer.
- `--specialists all` is an explicit expensive mode. Never choose it unless the
  user asks for exhaustive specialist coverage.

Do not add `--loop` to a normal read-only review. A loop is useful only after
the reviewed code changes and the user explicitly requests another pass.

Runtime evidence is written to:

```text
${GOLDBAND_HOME:-$HOME/.goldband}/workflow-runs/review-code.jsonl
```

## Inline review fallback

Use this path when reviewing directly in the current agent instead of launching
the programmatic runtime.

### 1. Establish scope and intent

1. Read the full diff from its merge base with the detected base branch.
2. Read the PR body when available; otherwise use changed tests and commit
   messages to identify the intended behavior.
3. If intent remains unclear, say so. Do not invent requirements.

### 2. Load the review contract

Resolve the active runtime root from `GOLDBAND_ROOT`, then read:

- `$GOLDBAND_ROOT/review/shared-rubric.md`
- `$GOLDBAND_ROOT/review/findings-schema.md`
- `$GOLDBAND_ROOT/review/checklist.md`
- `$GOLDBAND_RULES_DIR/semantic-review-criteria.md` (**mandatory**)

Read `semantic-review-criteria.md` completely before inspecting findings. Its
criteria are non-negotiable and must not be weakened, skipped, or replaced by a
summary. If `GOLDBAND_RULES_DIR` is empty or any contract file is unavailable,
STOP and report the missing path. Do not continue with a reduced review contract
or use a similarly named file from another installation.

### 3. Trace changed behavior

For each risky change:

1. Identify the valid input or runtime state that reaches it.
2. Follow the actual caller, branch, state transition, and downstream consumer.
3. Compare the resulting behavior with the intended contract.
4. Inspect code outside the diff only when needed to verify reachability,
   ownership, registration, consumers, or existing protection.

Prioritize correctness, authorization, data loss, broken contracts, concurrency,
migration safety, and normal user workflows. Do not report style preferences,
generic best practices, or risks that are only hypothetical.

### 4. Finding validity gate

A finding is valid only when it has all three:

- an exact `file:line`;
- a concrete input or runtime state and a reachable execution path;
- the incorrect result, expected result, and practical impact.

If any part is missing, keep investigating or omit the finding. A suspicious
pattern alone is not a finding. Use the lowest severity supported by evidence.

### 5. Output

Put blocking findings first. Keep each finding compact:

```text
[P1] Short problem title — path/to/file.ts:42

When <input/state>, execution reaches <path> and produces <actual> instead of
<expected>, causing <impact>.

Fix: <one-sentence healthy fix>
```

Do not print confidence scores. Confidence is an internal suppression decision:
if the finding is not well supported, do not output it. Mention a test gap only
when the missing test materially explains why the regression can ship.

If no findings survive the gate, output `No findings.` and briefly name the
high-risk paths that were actually traced.

## Completion boundary

- Read the full diff before concluding.
- Never claim a path is safe, handled elsewhere, or covered by tests without
  reading the exact supporting code or test.
- `/review` reports findings only. Fixing, committing, pushing, and external
  comment replies belong to a separate explicitly authorized workflow.
