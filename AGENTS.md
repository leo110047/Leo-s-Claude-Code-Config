# goldband Repository Instructions

This repository manages configuration for both Claude Code and Codex.

## Primary Goal

Keep shared engineering policy portable across tools while keeping tool-specific adapters explicit.

## When Editing This Repo

- Keep Claude assets (`hooks/`, `commands/`, `contexts/`, `rules/`, `.claude-plugin/`) and Codex assets (`codex/`, `.codex/`, `AGENTS.md`) in sync when a shared policy changes.
- Do not claim dual-tool parity until the installer, README, and inventory documentation all reflect the same change.
- Use the shared, portable skills when possible. Treat Claude-specific hooks and Codex-specific rules as adapters, not as sources of truth.
- When changing Claude hook or installer behavior, run the Claude config verification workflow before claiming the change is safe.
- When changing Codex rules or global templates, validate rule syntax with `codex execpolicy check` and verify installer output under a temp `HOME`.

## Preferred Portable Skills

If the portable goldband skills are installed for Codex, prefer:

- `$evidence-based-coding`
- `$systematic-debugging`
- `$file-search`
- `$planning-workflow`
- `$security-checklist`
- `$performance-optimization`

Use repo-specific skills only when the task is actually about maintaining goldband itself.
