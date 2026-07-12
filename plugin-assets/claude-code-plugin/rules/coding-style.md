# Coding Style

This rule file is split into enforceable checks and advisory engineering
guidance. Enforceable checks are implemented by `scripts/check-code-style.mjs`
and may block commits only when the optional goldband global git hooks are
installed explicitly with `./install.sh style-gate`.

## Enforceable Gate

The numeric defaults below are maintainability guardrails, not universal proof
of correctness. Repositories may tune them consistently for their domain, but
must not raise a threshold or add a bypass only to make one change pass.

| Rule | Default | Tool |
|---|---:|---|
| Code file length | `GOLDBAND_MAX_FILE_LINES=600` | `check-code-style.mjs` |
| JS/TS function length | `GOLDBAND_MAX_FN_LINES=50` | Biome `noExcessiveLinesPerFunction` |
| JS/TS cognitive complexity | `GOLDBAND_MAX_COMPLEXITY=12` | Biome `noExcessiveCognitiveComplexity` |
| JS/TS function parameters | `GOLDBAND_MAX_PARAMS=4` | Biome `useMaxParams` |
| JS/TS unused imports and variables | n/a | Biome `noUnusedImports` / `noUnusedVariables` |
| Formatter drift | n/a | Biome formatter |
| Merge conflict blocks | n/a | `check-code-style.mjs` |
| High-confidence secrets | n/a | shared hook-router `secret-patterns` |
| Sensitive files | n/a | path gate for `.env`, keys, OS noise, generated deps |
| Large text/binary files | text 1 MB, binary 512 KB | `check-code-style.mjs` |
| Escape hatches | n/a | staged added-line scan |
| Focused tests | n/a | staged added-line scan |
| Skipped tests | n/a | staged added-line scan |
| `debugger` and non-CLI `console.log` | n/a | staged added-line scan |

Currently blocked escape hatches:

- `@ts-ignore`
- `@ts-nocheck`
- `as unknown as`
- `biome-ignore`
- whole-file `eslint-disable`

Advisory-only checks for now:

- shell and Python function length heuristics
- explicit `any`
- `@ts-expect-error` without a useful reason
- missing Biome installation; zero-dependency checks still run

## Enforcement Surfaces

- The git style gate is opt-in and checks staged files before commit.
- Manual and CI checks scan first-party tracked code.
- Claude and Codex PostToolUse checks are advisory; they do not block edits.
- `.goldband-no-style-gate` is a visible repository opt-out.
  `GOLDBAND_STYLE_GATE=0` is a logged temporary bypass.
- A repository-local `core.hooksPath`, such as Husky, overrides the global hook.

## Advisory Engineering Guidance

Prefer:

- immutable updates over in-place mutation
- readable names over clever abbreviations
- explicit error handling at boundaries
- schema or typed validation for external input
- constants or configuration for repeated magic values
- high-cohesion files organized by feature or domain
- capability-based names for durable scripts, commands, environment variables,
  workflows, and output labels; avoid names tied to a temporary phase or one
  historical incident
- comments that state the invariant and why it exists instead of narrating a
  dated incident, temporary state, or one triggering example

Before marking work complete, verify that the relevant gate, test, or command
actually ran and covered the changed behavior.
