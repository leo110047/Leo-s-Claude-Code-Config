# Git Workflow

## Baseline Policy

Git history should describe logical changes and their verification without
turning one task into unrelated cleanup. Committing, pushing, opening a pull
request, merging, and releasing are separate actions; perform only the actions
the user authorized.

## Required Behavior

- Before reviewing or summarizing a pull request, inspect the full change range
  against the verified base branch and read relevant commit history. Do not
  infer the base branch or describe only the latest commit.
- Test in proportion to the changed behavior and risk. Prefer a regression test
  when it can reproduce the failure. TDD is useful when the expected behavior
  is clear, but it is not mandatory for every change.
- Treat coverage as diagnostic evidence, not a universal percentage target.
  Project-owned thresholds may still block when they encode an explicit risk or
  product requirement.
- Keep commits focused on one logical change. Use the repository's commit
  convention; when none exists, use `<type>: <description>` with `feat`, `fix`,
  `refactor`, `docs`, `test`, `chore`, `perf`, or `ci`.
- Commit messages and pull request summaries must state what changed and how it
  was verified. Include remaining risk or skipped verification when relevant.
- Never stage unrelated user changes. Do not commit, push, create a pull
  request, merge, or release without authorization for that action.

## Failure Signals

- A pull request summary describes a subset of the actual diff.
- Tests pass only because a check, assertion, or threshold was weakened.
- Coverage rises while the changed failure mode remains untested.
- A commit mixes the requested change with formatting or unrelated refactors.
- Git state is mutated beyond what the user authorized.
