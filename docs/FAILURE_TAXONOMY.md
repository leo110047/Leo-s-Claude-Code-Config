# Failure Taxonomy

This file is the maintenance log for guardrail failures. Every verified incident
should produce one taxonomy entry and one regression case in either the hook
router replay dataset, a focused script test, or Goldband Loop eval coverage.

## Required workflow

1. Record the incident here with evidence, impact, and classification.
2. Add or update a regression case that would have caught it.
3. Link the regression case in the entry.
4. Run the matching gate before merging.

For hook policy changes, the default regression target is
`hooks/fixtures/router/replay-fixtures.json` plus
`scripts/check-hook-router-coverage.mjs`.

## Categories

| Category | Definition | Default regression target |
|---|---|---|
| hook false block | A hook blocks safe work or makes normal development harder than intended. | hook router replay allow case |
| hook false allow | A hook allows a known unsafe action or misses a guardrail condition. | hook router replay block case |
| skill mis-trigger | A prompt or hook suggests the wrong skill, duplicate skill, or noisy workflow entry. | skill activation test or Goldband Loop eval |
| installer breakage | Install, uninstall, status, Windows, symlink, or managed-profile behavior breaks. | installer integration test |
| upstream drift | A host, API, schema, or inherited runtime assumption changes underneath goldband. | host adapter test, inventory gate, or eval |

## Historical cases

### hook false allow: freeze-mode shell policy gaps

- Evidence: `d6b71f5 fix(hooks): harden freeze-mode policy`.
- Search scope: `git log --oneline --grep='fix' --grep='hook' --grep='freeze'`
  and `git show --stat d6b71f5`.
- Impact: freeze-mode is supposed to be read-only. The fix added replay coverage
  around shell control operators, write-shaped commands, and read-only command
  boundaries.
- Regression target: `hooks/fixtures/router/replay-fixtures.json`,
  `freeze-mode` coverage rows.

### hook false allow: Codex compact hooks unsupported by host

- Evidence: `fd9d6b3 fix(codex): remove unsupported compact hooks`.
- Search scope: `git log --oneline --grep='fix' --grep='codex' --grep='hook'`
  and `git show --stat fd9d6b3`.
- Impact: Codex hook config contained lifecycle hooks the host did not support,
  creating drift between claimed and executable hook coverage.
- Regression target: `scripts/test-codex-hook-router.mjs` and portability checks.

### skill mis-trigger: prompt skill activation suggestions

- Evidence: `aed1b22 feat: add prompt skill activation suggestions`.
- Search scope: `git log --oneline --grep='skill' --grep='suggest'` and
  `git show --stat aed1b22`.
- Impact: skill suggestions became a first-class hook surface. Future false
  positives, duplicate suggestions, or wrong workflow recommendations should be
  classified here.
- Regression target: skill activation rules tests or Goldband Loop routing evals.

### installer breakage: Windows link fallback idempotency

- Evidence: `ac0d9b4 fix(installer): verify Windows link fallback idempotency`.
- Search scope: `git log --oneline --grep='fix' --grep='installer' --grep='Windows'`
  and `git show --stat ac0d9b4`.
- Impact: Windows fallback linking needed explicit idempotency coverage so reruns
  do not produce broken or duplicated installed assets.
- Regression target: `scripts/test-workflow-integration.sh` and
  `scripts/test-windows-platform-integration.mjs`.

### installer breakage: repo-local runtime detection

- Evidence: `105e699 fix(workflow): harden repo-local runtime detection`.
- Search scope: `git log --oneline --grep='fix' --grep='workflow'` and
  `git show --stat 105e699`.
- Impact: repo-local runtime detection can choose the wrong runtime path if
  wrapper or symlink assumptions drift.
- Regression target: workflow installer integration tests and inventory gate.

### upstream drift: inherited compact hook support changed

- Evidence: `fd9d6b3 fix(codex): remove unsupported compact hooks`.
- Search scope: `git log --oneline --grep='upstream' --grep='drift' --grep='codex'`
  plus targeted `git show --stat fd9d6b3`.
- Impact: host-supported hook phases are not stable enough to treat as prose
  claims. Unsupported phases must be removed or guarded by tests.
- Regression target: Codex hook router tests and `bash scripts/check-codex-portability.sh`.

### hook false block: global style gate dependency failure

- Evidence: `1a2920a fix(style-gate): harden global hook behavior`.
- Search scope: `git log --oneline --grep='block' --grep='false'
  --grep='safe' --grep='allow' --grep='careful' --grep='doc' --grep='server'
  --grep='dev' --grep='hook' --grep='advisory' --grep='deny'
  --extended-regexp`, targeted hook-path history, and `git show 1a2920a`.
- Impact: global pre-commit hooks must not block unrelated repositories when
  the goldband checkout, checker script, or `node` runtime is unavailable. The
  fix added fail-soft behavior and regression tests for missing checker and
  missing node cases.
- Regression target: `scripts/test-code-style-gate.mjs` fail-soft tests and
  future hook router allow cases for safe-but-dependency-missing paths.
