---
name: file-search
description: Use when you need to locate files, usages, symbols, text patterns, or structural code matches quickly with ripgrep first, and ast-grep only when it is actually available.
license: MIT
---

# File Search Skill

Use `rg` as the default search engine. Reach for `sg` only when the environment actually has it installed and the task genuinely needs syntax-aware matching.

## When to Use

- Understanding an unfamiliar repo before making behavioral claims
- Finding call sites, imports, config references, or entry points
- Narrowing impact before a refactor
- Locating repeated anti-patterns, security smells, or TODO clusters
- Answering “where is X used/defined?” with concrete evidence

## Verified Tool Availability

- `rg`: available in this repo environment
- `sg`: not installed in this repo environment right now

That means the default operational path here is `rg` plus targeted file reads. If you want AST-aware search in another environment, verify it first with `which sg`.

## Gotchas

- Do not start with a repo-wide broad search if a likely directory or file type is already obvious.
- Do not stop at the match list; read the actual files before making behavioral claims.
- Do not claim structural certainty from regex alone when the task really needs syntax awareness.
- Do not dump hundreds of raw matches into the response; summarize and narrow.
- Do not assume “no matches” proves absence when ignored files, generated output, or binary content may be excluded from the search.
- Do not document `sg` workflows as mandatory in environments where `sg` is not installed.

## Workflow

1. Start with `rg --files` or a scoped `rg` query to map likely locations.
2. Narrow by directory, extension, or exact token before reading files.
3. Read the matched files that matter.
4. If the task depends on AST shape and `sg` exists, switch to `sg`.
5. Summarize findings with concrete file paths, not raw search spam.

## Core Commands

### Ripgrep (`rg`)

```bash
# File inventory
rg --files
rg --files src

# Text search
rg "pattern" src/
rg -n -C 2 "pattern" src/
rg -l "pattern"
rg --count "pattern"

# Narrowing
rg "pattern" --type ts src/
rg "pattern" src/ --glob '!**/*.test.ts'
rg -w "ExactSymbol"
```

### AST-Grep (`sg`, optional)

Only use these when `which sg` succeeds:

```bash
sg --pattern 'function $NAME($$$) { $$$ }' --lang js src/
sg --pattern 'class $NAME { $$$ }' --lang ts src/
sg --pattern 'import $X from $Y' --lang ts src/
```

## Search Strategy

### Start Narrow

```bash
# Better first pass
rg "LoginService" src/services/

# Worse first pass
rg "service" .
```

### Count Before Reading Everything

```bash
rg "TODO" --count
rg "featureFlag" --count src/
```

### Limit Output

```bash
rg "import" src/ | head -20
rg "error" --type ts src/ | head -30
```

### Move from Search to Evidence

```bash
rg -n "getUserById" src/
sed -n '1,160p' path/to/matching-file.ts
```

## Common Patterns

```bash
# Entry points
rg -n "main\\(|createRoot\\(|express\\(" src/

# Imports
rg -n "^import .* from " --type ts src/

# Security smells
rg -n -i "password\\s*=|api[_-]?key|secret" .

# Console logging
rg -n "console\\.log\\(" src/

# Schema / config references
rg -n "schema|migration|feature_flag|ENV_NAME" .
```

## Choosing Between `rg` and `sg`

- Use `rg` when you care about filenames, strings, imports, comments, or rough usage mapping.
- Use `sg` when regex overmatches and the task depends on code shape.
- If `sg` is unavailable, say so and continue with `rg` plus file reads instead of pretending syntax-aware search happened.
