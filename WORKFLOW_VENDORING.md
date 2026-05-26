# Workflow Vendoring Runbook

This runbook is the source of truth for updating `vendor/workflow` inside
goldband.

## Outcome

A complete workflow vendor update leaves the repo in this state:

- `vendor/workflow/` is a full upstream source snapshot, excluding generated or
  dependency artifacts already ignored by `vendor/workflow/.gitignore`.
- goldband user-facing names remain `goldband-*` and `workflow-*`; upstream
  `gstack-*` names may exist inside `vendor/workflow`, but they must not become
  the primary goldband entry points.
- `shell/install/workflow.sh` remains the single source of truth for wrapper
  aliases through `workflow_wrapper_manifest()`.
- `commands/scripts/set-goldband-language.sh` derives wrapper descriptions from
  `workflow_wrapper_manifest()` and does not keep a second description list.
- Root docs describe goldband as the integration and policy layer, not as the
  workflow runtime product.

## Update Steps

1. Start from a clean worktree and record the current branch:

   ```bash
   git status --short
   git rev-parse --abbrev-ref HEAD
   ```

2. Fetch or clone the upstream workflow source into `/private/tmp` or another
   disposable directory.

3. Replace the vendored source snapshot:

   ```bash
   rsync -a --delete --exclude .git --exclude node_modules /path/to/upstream/ vendor/workflow/
   ```

4. Reapply the goldband integration layer outside the vendor boundary:

   - compatibility wrappers in `vendor/workflow/bin/workflow-*` when upstream
     only exposes `gstack-*`
   - `workflow_wrapper_manifest()` coverage in `shell/install/workflow.sh`
   - `GSTACK_HOME="$HOME/.workflow"` install behavior
   - language wrapper runtime injection
   - CI and verification docs

5. Regenerate workflow skill docs if templates changed:

   ```bash
   cd vendor/workflow
   bun run gen:skill-docs
   bun run gen:skill-docs --host codex
   ```

6. Stage all source changes, then verify ignored artifacts are not staged:

   ```bash
   git add -A
   git diff --cached --name-only | rg '(^|/)node_modules/|(^|/)\\.agents/|(^|/)\\.factory/|(^|/)dist/'
   ```

   The second command must print nothing.

## Verification

Run these checks before committing a workflow vendor update:

```bash
bash scripts/check-workflow-vendor-integration.sh
bash scripts/test-workflow-integration.sh
bash scripts/check-skills.sh
bash scripts/check-codex-portability.sh
bash scripts/verify-decision-guidance.sh
node scripts/test-windows-platform-integration.mjs
node --check scripts/goldband-windows.mjs
bash -n shell/install/workflow.sh scripts/check-workflow-vendor-integration.sh scripts/test-workflow-integration.sh shell/goldband-install-workflow.sh
git diff --check
git diff --cached --check
```

For deeper vendor confidence, run the upstream free test shard from
`vendor/workflow` after dependencies are installed:

```bash
bun test browse/test/ test/ make-pdf/test/ --ignore 'test/skill-e2e-*.test.ts' --ignore test/skill-llm-eval.test.ts --ignore test/skill-routing-e2e.test.ts --ignore test/codex-e2e.test.ts --ignore test/gemini-e2e.test.ts --reporter=dots --only-failures
```

Treat warnings as information, but do not ignore test runner failures or dirty
worktree output.

## Constraints

- Do not edit generated directories such as `vendor/workflow/.agents/`,
  `vendor/workflow/.factory/`, `vendor/workflow/*/dist/`, or
  `vendor/workflow/node_modules/`.
- Do not duplicate wrapper descriptions outside
  `workflow_wrapper_manifest()`.
- Do not expose upstream `gstack-*` names as goldband's primary user-facing
  names.
- Do not claim dual-tool parity until the installer, README, command docs, and
  validation scripts agree.
- Do not push until verification commands have been run in the current turn.

## Iteration Policy

While working, keep a short record of:

- upstream source and version
- files changed outside `vendor/workflow`
- goldband patches reapplied after vendoring
- commands run and their pass/fail result
- intentionally skipped checks and why

## Error Handling

Stop and report instead of guessing when:

- upstream no longer has `VERSION`, `package.json`, `setup`, or generated skill
  conventions expected by the installer
- `workflow_wrapper_manifest()` cannot cover all top-level vendored
  `SKILL.md` files without changing user-facing naming policy
- install smoke tests create both `gstack` and `workflow` roots for the same
  host
- a verification command fails and the failure is not clearly unrelated to the
  vendor update
