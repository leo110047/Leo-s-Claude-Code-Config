# Codex Modernization Notes

## P5 Status

P5 is partially implemented and intentionally deferred at the runtime-adoption
layer.

Implemented now: configuration cleanup, Codex agents/hooks installation,
packaging placeholders, MCP templates, and operations documentation.

Not completed yet: enabling `auto_review`, migrating to named permission
profiles, enabling token-backed MCP servers, scheduled automations, and active
plugin marketplace distribution.

## Implemented

- Workflow-aligned read-only helpers: `codex/agents/reviewer.toml`,
  `codex/agents/explorer.toml`, and `codex/agents/planner.toml`.
- Global agent config: `codex/config.toml` declares `[agents]` role entries and
  points at the custom agent files.
- Hooks parity: `codex/hooks.json` installs a Codex-specific hook router for
  `UserPromptSubmit`, `SessionStart`, `PreToolUse`, `PermissionRequest`,
  `PostToolUse`, `SubagentStop`, `PreCompact`, `PostCompact`, and `Stop`.
  Deny behavior is limited to high-risk Bash
  commands or high-confidence secret/private-key patch content; non-risky
  cases continue with workflow hints or context reminders.
- Telemetry baseline: `[otel] exporter = "none"` and `log_user_prompt = false`.
- Plugin packaging placeholder: `.codex-plugin/plugin.json` plus
  `codex/plugin-marketplace/`.
- MCP templates: `mcp/claude.mcp.json.template` and
  `mcp/codex.config.toml.template`.
- Removed stale `notice.model_migrations` from `codex/config.toml`.

## Intentionally Not Enabled by Default

- `approvals_reviewer = "auto_review"`: keep as a later experiment because it
  changes who reviews approval prompts, even though it does not loosen sandboxing.
- `default_permissions` and custom `[permissions.<name>]` profiles: keep current
  `sandbox_mode` + `profiles.*` until installer migration is tested on both POSIX
  and Windows.
- Token-backed MCP servers: templates exist, but users must provide credentials
  and run MCP Inspector before enabling them.
- Scheduled automations: documented in `OPERATIONS.md`; not installed by the repo.

## Verification Targets

- `codex execpolicy check codex/rules/default.rules`
- `bash scripts/check-codex-portability.sh`
- temp-`HOME` installer run for `codex-full`
- JSON syntax checks for `codex/hooks.json`, plugin manifests, and marketplace
  prototype
- MCP Inspector smoke test for each MCP server before enabling it
