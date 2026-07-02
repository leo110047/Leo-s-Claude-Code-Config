# Coding Style

This rule file is split into enforceable checks and advisory engineering
guidance. Enforceable checks are implemented by `scripts/check-code-style.mjs`
and may block commits only when the optional goldband global git hooks are
installed explicitly with `./install.sh style-gate`.

## Enforceable Gate

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

Blocked escape hatches:

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

## Scope

Default install packs do not change global git settings. Install the local hook
explicitly with:

```bash
./install.sh style-gate
```

The global git hook checks only staged files with:

```bash
node scripts/check-code-style.mjs --staged
```

Manual and CI checks scan first-party tracked code with:

```bash
node scripts/check-code-style.mjs
```

Claude and Codex PostToolUse hooks call the same script with `--files`; those
warnings are advisory and do not block tool use.

Per-repo opt-out:

- add `.goldband-no-style-gate` at the repo root for a visible permanent opt-out
- use `GOLDBAND_STYLE_GATE=0` for a temporary bypass; the hook prints a warning
  and writes a local bypass log

Projects with their own local `core.hooksPath` such as Husky are not affected by
the global hook because git local config overrides global config.

## Advisory Engineering Guidance

Prefer:

- immutable updates over in-place mutation
- readable names over clever abbreviations
- explicit error handling at boundaries
- schema or typed validation for external input
- constants or configuration for repeated magic values
- high-cohesion files organized by feature or domain

Before marking work complete, verify that the relevant gate, test, or command
actually ran and covered the changed behavior.
