# Contributing

## Plugin Distribution Changes

When changing any source asset that feeds the Claude Code plugin, regenerate the
plugin package before committing:

```bash
node scripts/sync-plugin-assets.mjs
npm run test:plugin-distribution
```

This applies to:

- `commands/`
- `rules/`
- `hooks/`
- `skills/global/`
- `scripts/lib/plugin-distribution.mjs`
- `scripts/lib/plugin-hook-summary.mjs`
- `scripts/check-plugin-distribution.mjs`

`npm run test:plugin-distribution` intentionally runs the full Claude CLI path:
manifest validation, local marketplace add, temp-HOME install, installed asset
diff, and packaged hook runtime smoke. Do not replace it with
`node scripts/check-plugin-distribution.mjs --skip-cli` for local pre-commit
verification; `--skip-cli` is only the structural CI fallback when the Claude
CLI path is being checked separately.
