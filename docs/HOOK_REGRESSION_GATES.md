# Hook Regression Gates

Phase 4 makes hook policy regression measurable. The PR-required path is free
and deterministic; paid evals are opt-in only.

## Required/free gate

Runs on every push and pull request through `.github/workflows/validate.yml`:

```bash
npm run test:hook-router
npm run test:hook-router:coverage
npm run test:eval-budget-cap
bash scripts/check-skills.sh
bash scripts/check-codex-portability.sh
node scripts/check-code-style.mjs
npm run test:style-gate
python3 scripts/verify-hook-script-references.py
bash scripts/verify-decision-guidance.sh
node scripts/check-goldband-loop-inventory.mjs
cd goldband-loop && bun run test:free
bash scripts/test-workflow-integration.sh
bash scripts/test-goldband-loop-playwright-setup.sh
```

`test:hook-router` replays `hooks/fixtures/router/replay-fixtures.json`.
`test:hook-router:coverage` reads that same dataset plus the live policy modules:

- `hooks/scripts/lib/hook-router/secret-patterns.js`
- `hooks/scripts/lib/hook-router/pretool-policy.js`
- `hooks/scripts/lib/hook-router/careful-mode-rules.js`
- `hooks/scripts/lib/hook-router/freeze-mode-rules.js`

The coverage check fails when a required policy row has no positive and negative
case. Every replay case must include machine-readable `coverage` metadata:
`category`, `policy`, `expectedDecision`, `variant`, and `regressionSource`.
It also checks that emitted `pretool-policy.js` `blockedBy` names stay in sync
with `PRETOOL_DENY_POLICIES`, and that warn-level secret patterns assert their
advisory warning output.

Current golden dataset baseline:

- `secret-patterns`: every pattern has one matching case and one negative case.
- `pretool-policy`: `dev-server-blocker` and `doc-file-blocker` have block and
  allow cases.
- `careful-mode`: every destructive guard has block and allow cases.
- `freeze-mode`: every protection rule has block and allow cases.

## Optional/paid eval

Paid evals run only from `.github/workflows/goldband-loop-paid-evals.yml`.

Triggers:

- `workflow_dispatch`: maintainer chooses `test:gate`, `test:e2e`,
  `test:evals`, or `test:periodic`, and must set `confirm_budget=true`.
- `schedule`: weekly, but remains skipped unless repo variable
  `GOLDBAND_EVALS_BUDGET_APPROVED=true`.
- `max_cost_usd`: post-run machine cap. The workflow sums `total_cost_usd`
  from eval JSON and fails when the run exceeds the requested cap.
  Unparseable or truncated eval JSON is reported and skipped so a partial file
  cannot turn the budget check into a false failure.

Required secrets:

- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`

If any secret is missing, or budget is not confirmed, the workflow runs only the
preflight and the `skipped` job. This is intentional: PRs must not look covered
by paid evals when paid evals did not run.

Root scripts wire the old eval names to the first-party Goldband Loop runtime:

```bash
npm run test:gate      # cd goldband-loop && bun run test:gate
npm run test:e2e       # cd goldband-loop && bun run test:e2e
npm run test:evals     # cd goldband-loop && bun run test:evals
npm run test:periodic  # cd goldband-loop && bun run test:periodic
```

## Cost reporting

Goldband Loop estimates model cost with
`goldband-loop/test/helpers/pricing.ts`. That table is marked `as_of: 2026-04`
and must be refreshed before treating estimates as current. Eval artifacts write
`total_cost_usd`; after a paid run, use:

```bash
cd goldband-loop && bun run eval:summary
```

The workflow uploads both eval artifact locations:
`~/.goldband-dev/evals/*.json` and `~/.goldband/projects/*/evals/*.json`.

Until secrets and budget are confirmed, Phase 4 completion evidence is the
required/free gate plus paid-eval preflight status, not paid-eval pass rate.

## Regression workflow

1. Add or update a taxonomy entry in `docs/FAILURE_TAXONOMY.md`.
2. Add one replay fixture, coverage row, or focused test that would have caught
   the failure.
3. Run `npm run test:hook-router` and `npm run test:hook-router:coverage`.
4. For PR evidence, temporarily break one fixture expectation or coverage row,
   show the gate fail, restore it, and show the gate pass.
